import { randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FileChange } from '@open-code-desk/domain';

import type { AgentTaskRepository } from '../agent/agent-task.repository';
import { ChangeArtifactStore, sha256 } from './artifact-store';
import { ChangePathResolver, type ResolvedWorkspaceFile } from './change-path-resolver';
import type { FileChangeAggregate, FileChangeRepository } from './file-change.repository';

interface RestorePlan {
  readonly change: FileChange;
  readonly restore: () => Promise<void>;
  readonly reapply: () => Promise<void>;
}

function privateSibling(targetPath: string, kind: 'tmp' | 'backup'): string {
  return join(dirname(targetPath), `.opencode-${randomUUID()}.${kind}`);
}

async function writeTemporary(targetPath: string, content: string, mode: number): Promise<string> {
  const temporaryPath = privateSibling(targetPath, 'tmp');
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(Buffer.from(content, 'utf8'));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporaryPath;
}

async function createWithoutOverwrite(
  targetPath: string,
  content: string,
  mode: number,
): Promise<void> {
  const temporaryPath = await writeTemporary(targetPath, content, mode);
  try {
    await link(temporaryPath, targetPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function replaceAtomically(target: ResolvedWorkspaceFile, content: string): Promise<void> {
  const temporaryPath = await writeTemporary(target.absolutePath, content, target.mode);
  const backupPath = privateSibling(target.absolutePath, 'backup');
  await rename(target.absolutePath, backupPath);
  try {
    await rename(temporaryPath, target.absolutePath);
    await unlink(backupPath).catch(() => undefined);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    await rename(backupPath, target.absolutePath).catch(() => undefined);
    throw error;
  }
}

function noopPlan(change: FileChange): RestorePlan {
  return {
    change,
    async restore() {
      return undefined;
    },
    async reapply() {
      return undefined;
    },
  };
}

export class FileChangeRollbackService {
  public constructor(
    private readonly repository: FileChangeRepository,
    private readonly artifacts: ChangeArtifactStore,
    private readonly paths: ChangePathResolver,
    private readonly tasks: AgentTaskRepository,
  ) {}

  public async restoreAggregate(
    aggregate: FileChangeAggregate,
    requireAppliedState: boolean,
  ): Promise<void> {
    const candidates = aggregate.changes.filter((change) =>
      ['applied', 'approved', 'failed'].includes(change.status),
    );
    const plans: RestorePlan[] = [];
    for (const change of candidates) {
      plans.push(
        await this.preparePlan(aggregate.changeSet.workspaceId, change, requireAppliedState),
      );
    }

    this.repository.updateSet(aggregate.changeSet.id, {
      status: 'rolling_back',
      error: null,
    });
    const executed: RestorePlan[] = [];
    try {
      for (const plan of plans) {
        await plan.restore();
        executed.push(plan);
      }
    } catch (error) {
      const compensationErrors: string[] = [];
      for (const plan of executed.reverse()) {
        try {
          await plan.reapply();
        } catch (compensationError) {
          compensationErrors.push(
            compensationError instanceof Error
              ? compensationError.message
              : 'Unknown rollback compensation failure.',
          );
        }
      }
      const message = error instanceof Error ? error.message : 'Rollback failed.';
      this.repository.updateSet(aggregate.changeSet.id, {
        status: compensationErrors.length === 0 ? 'applied' : 'failed',
        error:
          compensationErrors.length === 0
            ? `Rollback failed and was compensated: ${message}`
            : `Manual recovery required: ${message} ${compensationErrors.join(' ')}`,
      });
      throw new Error(
        compensationErrors.length === 0
          ? `${message} Earlier rollback steps were compensated.`
          : `${message} Rollback compensation also failed: ${compensationErrors.join(' ')}`,
      );
    }

    const now = new Date().toISOString();
    for (const change of candidates) {
      this.repository.updateChange(change.id, {
        status: 'rolled_back',
        appliedHash: null,
        rolledBackAt: now,
        error: null,
      });
    }
    this.repository.updateSet(aggregate.changeSet.id, {
      status: 'rolled_back',
      rolledBackAt: now,
      error: null,
    });
    this.tasks.update(aggregate.changeSet.taskId, 'completed');
  }

  public async recoverInterrupted(
    interrupted: ReadonlyArray<FileChangeAggregate>,
  ): Promise<number> {
    let recovered = 0;
    for (const aggregate of interrupted) {
      try {
        await this.restoreAggregate(aggregate, false);
        recovered += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Interrupted change recovery failed.';
        this.repository.updateSet(aggregate.changeSet.id, {
          status: 'failed',
          error: `Manual recovery required: ${message}`,
        });
        this.tasks.update(aggregate.changeSet.taskId, 'failed', {
          error: {
            code: 'PATCH_CONFLICT',
            message: `An interrupted file transaction could not be recovered safely: ${message}`,
            retryable: false,
          },
        });
      }
    }
    return recovered;
  }

  private async preparePlan(
    workspaceId: string,
    change: FileChange,
    requireAppliedState: boolean,
  ): Promise<RestorePlan> {
    const originalContent =
      change.originalArtifactRef === undefined
        ? undefined
        : await this.artifacts.getText(change.originalArtifactRef);
    const proposedContent =
      change.proposedArtifactRef === undefined
        ? undefined
        : await this.artifacts.getText(change.proposedArtifactRef);
    const source = await this.paths.inspect(workspaceId, change.filePath);

    if (change.operation === 'create') {
      if (source === null) {
        if (requireAppliedState) {
          throw new Error(`${change.filePath} no longer exists; rollback was blocked.`);
        }
        return noopPlan(change);
      }
      if (
        proposedContent === undefined ||
        change.proposedHash === undefined ||
        sha256(source.bytes) !== change.proposedHash
      ) {
        throw new Error(`${change.filePath} changed after apply; rollback was blocked.`);
      }
      return {
        change,
        restore: async () => unlink(source.absolutePath),
        reapply: async () => {
          const vacant = await this.paths.vacant(workspaceId, change.filePath);
          await createWithoutOverwrite(vacant.absolutePath, proposedContent, source.mode);
        },
      };
    }

    if (change.operation === 'update') {
      if (source === null || originalContent === undefined || change.baselineHash === undefined) {
        throw new Error(`${change.filePath} cannot be restored from its snapshot.`);
      }
      const currentHash = sha256(source.bytes);
      if (currentHash === change.baselineHash && !requireAppliedState) {
        return noopPlan(change);
      }
      if (
        proposedContent === undefined ||
        change.proposedHash === undefined ||
        currentHash !== change.proposedHash
      ) {
        throw new Error(`${change.filePath} changed after apply; rollback was blocked.`);
      }
      return {
        change,
        restore: async () => replaceAtomically(source, originalContent),
        reapply: async () => {
          const restored = await this.paths.existing(workspaceId, change.filePath);
          if (sha256(restored.bytes) !== change.baselineHash) {
            throw new Error(`${change.filePath} changed during rollback compensation.`);
          }
          await replaceAtomically(restored, proposedContent);
        },
      };
    }

    if (change.operation === 'delete') {
      if (source !== null) {
        if (
          !requireAppliedState &&
          change.baselineHash !== undefined &&
          sha256(source.bytes) === change.baselineHash
        ) {
          return noopPlan(change);
        }
        throw new Error(`${change.filePath} was recreated after apply; rollback was blocked.`);
      }
      if (originalContent === undefined) {
        throw new Error(`${change.filePath} has no rollback snapshot.`);
      }
      const vacant = await this.paths.vacant(workspaceId, change.filePath);
      return {
        change,
        restore: async () => createWithoutOverwrite(vacant.absolutePath, originalContent, 0o600),
        reapply: async () => {
          const restored = await this.paths.existing(workspaceId, change.filePath);
          if (change.baselineHash === undefined || sha256(restored.bytes) !== change.baselineHash) {
            throw new Error(`${change.filePath} changed during rollback compensation.`);
          }
          await unlink(restored.absolutePath);
        },
      };
    }

    return this.prepareRenamePlan(workspaceId, change, source, requireAppliedState);
  }

  private async prepareRenamePlan(
    workspaceId: string,
    change: FileChange,
    source: ResolvedWorkspaceFile | null,
    requireAppliedState: boolean,
  ): Promise<RestorePlan> {
    if (change.destinationPath === undefined) {
      throw new Error(`${change.filePath} has no rename destination.`);
    }
    const destination = await this.paths.inspect(workspaceId, change.destinationPath);
    if (
      source !== null &&
      destination === null &&
      !requireAppliedState &&
      change.baselineHash !== undefined &&
      sha256(source.bytes) === change.baselineHash
    ) {
      return noopPlan(change);
    }
    if (
      source !== null ||
      destination === null ||
      change.proposedHash === undefined ||
      sha256(destination.bytes) !== change.proposedHash
    ) {
      throw new Error(`${change.filePath} or its rename target changed; rollback was blocked.`);
    }
    const restoredSource = await this.paths.vacant(workspaceId, change.filePath);
    return {
      change,
      restore: async () => rename(destination.absolutePath, restoredSource.absolutePath),
      reapply: async () => {
        const currentSource = await this.paths.existing(workspaceId, change.filePath);
        const vacantDestination = await this.paths.vacant(
          workspaceId,
          change.destinationPath ?? '',
        );
        if (
          change.baselineHash === undefined ||
          sha256(currentSource.bytes) !== change.baselineHash
        ) {
          throw new Error(`${change.filePath} changed during rollback compensation.`);
        }
        await rename(currentSource.absolutePath, vacantDestination.absolutePath);
      },
    };
  }
}
