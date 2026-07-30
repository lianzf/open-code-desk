import { randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FileChange } from '@open-code-desk/domain';

import type { AgentTaskRepository } from '../agent/agent-task.repository';
import { completeAgentTaskCheckpoint } from '../agent/agent-task-plan';
import type { AuditLogService } from '../audit/audit-log.service';
import { ChangeArtifactStore, sha256 } from './artifact-store';
import { ChangePathResolver, type ResolvedWorkspaceFile } from './change-path-resolver';
import type { FileChangeAggregate, FileChangeRepository } from './file-change.repository';
import type { FileChangeService } from './file-change.service';
import { FileChangeRollbackService } from './file-change-rollback.service';

interface ApplyPlan {
  readonly change: FileChange;
  readonly source: ResolvedWorkspaceFile | null;
  readonly sourcePath: string;
  readonly destinationPath?: string | undefined;
  readonly proposedContent?: string | undefined;
  temporaryPath?: string | undefined;
  backupPath?: string | undefined;
  executed: boolean;
}

export interface FileTransactionFaultInjector {
  beforeMutation(index: number, change: FileChange): Promise<void>;
}

function transactionPath(targetPath: string, kind: 'tmp' | 'backup'): string {
  return join(dirname(targetPath), `.opencode-${randomUUID()}.${kind}`);
}

async function writeTemporary(targetPath: string, content: string, mode: number): Promise<string> {
  const temporaryPath = transactionPath(targetPath, 'tmp');
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(Buffer.from(content, 'utf8'));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporaryPath;
}

async function installWithoutOverwrite(temporaryPath: string, targetPath: string): Promise<void> {
  await link(temporaryPath, targetPath);
  await unlink(temporaryPath);
}

function conflictMessage(change: FileChange): string {
  return `${change.filePath} changed after the proposal was created. Reload the workspace and generate a new proposal.`;
}

export class FileChangeTransactionService {
  readonly #rollback: FileChangeRollbackService;

  public constructor(
    private readonly repository: FileChangeRepository,
    private readonly changes: FileChangeService,
    private readonly artifacts: ChangeArtifactStore,
    private readonly paths: ChangePathResolver,
    private readonly tasks: AgentTaskRepository,
    private readonly faultInjector?: FileTransactionFaultInjector,
    private readonly audit?: AuditLogService,
  ) {
    this.#rollback = new FileChangeRollbackService(repository, artifacts, paths, tasks);
  }

  public async apply(
    changeSetId: string,
    expectedApplyDigest: string,
  ): Promise<FileChangeAggregate> {
    const aggregate = this.changes.get(changeSetId);
    if (aggregate.changeSet.status !== 'ready_to_apply') {
      throw new Error('The change set is not ready to apply.');
    }
    const currentDigest = this.changes.expectedApplyDigest(changeSetId);
    if (
      expectedApplyDigest !== currentDigest ||
      aggregate.changeSet.applyDigest !== currentDigest
    ) {
      throw new Error('The approval digest is stale. Review the visible changes again.');
    }
    const approved = aggregate.changes.filter((change) => change.status === 'approved');
    if (approved.length === 0) {
      throw new Error('No approved file changes are available to apply.');
    }

    const plans: ApplyPlan[] = [];
    try {
      for (const change of approved) {
        plans.push(await this.preparePlan(aggregate.changeSet.workspaceId, change));
      }
    } catch (error) {
      await this.cleanupPlans(plans);
      throw error;
    }

    this.repository.updateSet(changeSetId, {
      status: 'applying',
      error: null,
    });
    for (const plan of plans) {
      this.repository.updateChange(plan.change.id, {
        snapshotArtifactRef: plan.change.originalArtifactRef ?? null,
        error: null,
      });
    }

    try {
      for (const [index, plan] of plans.entries()) {
        await this.faultInjector?.beforeMutation(index, plan.change);
        await this.executePlan(plan);
        plan.executed = true;
        const now = new Date().toISOString();
        this.repository.updateChange(plan.change.id, {
          status: 'applied',
          appliedHash:
            plan.change.operation === 'delete' ? null : (plan.change.proposedHash ?? null),
          appliedAt: now,
          error: null,
        });
      }
      await this.commitPlans(plans);
      const now = new Date().toISOString();
      this.repository.updateSet(changeSetId, {
        status: 'applied',
        appliedAt: now,
        error: null,
      });
      this.tasks.update(aggregate.changeSet.taskId, 'completed', {
        checkpoint: completeAgentTaskCheckpoint(
          this.tasks.findById(aggregate.changeSet.taskId)?.checkpoint,
          '应用已批准的文件修改',
        ),
      });
      const applied = this.changes.get(changeSetId);
      this.audit?.record({
        workspaceId: aggregate.changeSet.workspaceId,
        conversationId: aggregate.changeSet.conversationId,
        taskId: aggregate.changeSet.taskId,
        actor: 'user',
        category: 'file_change',
        action: 'change_set.apply',
        outcome: 'succeeded',
        summary: `Applied ${approved.length} approved file change(s).`,
        metadata: { changeSetId, approvedChanges: approved.length },
      });
      return applied;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Applying the change set failed.';
      const compensationError = await this.compensatePlans(plans);
      await this.cleanupPlans(plans);
      for (const plan of plans) {
        if (plan.executed) {
          this.repository.updateChange(plan.change.id, {
            status: 'failed',
            appliedHash: null,
            error: compensationError ?? message,
            appliedAt: null,
          });
        }
      }
      this.repository.updateSet(changeSetId, {
        status: 'failed',
        error: compensationError ?? message,
        appliedAt: null,
      });
      this.tasks.update(aggregate.changeSet.taskId, 'failed', {
        error: {
          code: compensationError === null ? 'PATCH_CONFLICT' : 'UNKNOWN_ERROR',
          message:
            compensationError === null
              ? `${message} All earlier writes were compensated.`
              : `${message} Recovery also failed: ${compensationError}`,
          retryable: compensationError === null,
        },
      });
      this.audit?.record({
        workspaceId: aggregate.changeSet.workspaceId,
        conversationId: aggregate.changeSet.conversationId,
        taskId: aggregate.changeSet.taskId,
        actor: 'user',
        category: 'file_change',
        action: 'change_set.apply',
        outcome: 'failed',
        summary: `Applying file changes failed: ${message}`,
        metadata: { changeSetId, compensationFailed: compensationError !== null },
      });
      throw new Error(
        compensationError === null
          ? `${message} All earlier writes were rolled back.`
          : `${message} Automatic recovery failed: ${compensationError}`,
      );
    }
  }

  public async rollback(
    changeSetId: string,
    expectedApplyDigest: string,
  ): Promise<FileChangeAggregate> {
    const aggregate = this.changes.get(changeSetId);
    if (aggregate.changeSet.status !== 'applied') {
      throw new Error('Only an applied change set can be rolled back.');
    }
    if (aggregate.changeSet.applyDigest !== expectedApplyDigest) {
      throw new Error('The rollback digest is stale.');
    }
    await this.#rollback.restoreAggregate(aggregate, true);
    const rolledBack = this.changes.get(changeSetId);
    this.audit?.record({
      workspaceId: aggregate.changeSet.workspaceId,
      conversationId: aggregate.changeSet.conversationId,
      taskId: aggregate.changeSet.taskId,
      actor: 'user',
      category: 'file_change',
      action: 'change_set.rollback',
      outcome: 'succeeded',
      summary: `Rolled back ${aggregate.changes.length} file change(s).`,
      metadata: { changeSetId, changes: aggregate.changes.length },
    });
    return rolledBack;
  }

  public async recoverInterrupted(): Promise<number> {
    return this.#rollback.recoverInterrupted(this.repository.listInterrupted());
  }

  private async preparePlan(workspaceId: string, change: FileChange): Promise<ApplyPlan> {
    const proposedContent =
      change.proposedArtifactRef === undefined
        ? undefined
        : await this.artifacts.getText(change.proposedArtifactRef);
    if (
      proposedContent !== undefined &&
      (change.proposedHash === undefined || sha256(proposedContent) !== change.proposedHash)
    ) {
      throw new Error(`The proposed artifact for ${change.filePath} failed integrity validation.`);
    }

    if (change.operation === 'create') {
      const target = await this.paths.vacant(workspaceId, change.filePath);
      if (proposedContent === undefined) {
        throw new Error(`The create proposal for ${change.filePath} has no content.`);
      }
      const temporaryPath = await writeTemporary(target.absolutePath, proposedContent, 0o600);
      return {
        change,
        source: null,
        sourcePath: target.absolutePath,
        proposedContent,
        temporaryPath,
        executed: false,
      };
    }

    const source = await this.paths.existing(workspaceId, change.filePath);
    if (change.baselineHash === undefined || sha256(source.bytes) !== change.baselineHash) {
      throw new Error(conflictMessage(change));
    }

    if (change.operation === 'rename') {
      if (change.destinationPath === undefined) {
        throw new Error(`The rename proposal for ${change.filePath} has no destination.`);
      }
      const destination = await this.paths.vacant(workspaceId, change.destinationPath);
      return {
        change,
        source,
        sourcePath: source.absolutePath,
        destinationPath: destination.absolutePath,
        proposedContent,
        executed: false,
      };
    }

    if (change.operation === 'update') {
      if (proposedContent === undefined) {
        throw new Error(`The update proposal for ${change.filePath} has no content.`);
      }
      const temporaryPath = await writeTemporary(source.absolutePath, proposedContent, source.mode);
      return {
        change,
        source,
        sourcePath: source.absolutePath,
        proposedContent,
        temporaryPath,
        executed: false,
      };
    }

    return {
      change,
      source,
      sourcePath: source.absolutePath,
      executed: false,
    };
  }

  private async executePlan(plan: ApplyPlan): Promise<void> {
    if (plan.change.operation === 'create') {
      if (plan.temporaryPath === undefined) {
        throw new Error('Prepared create content is missing.');
      }
      await installWithoutOverwrite(plan.temporaryPath, plan.sourcePath);
      plan.temporaryPath = undefined;
      return;
    }

    if (plan.change.operation === 'rename') {
      if (plan.destinationPath === undefined) {
        throw new Error('Prepared rename destination is missing.');
      }
      await rename(plan.sourcePath, plan.destinationPath);
      const moved = await this.paths.existing(
        (await this.changes.get(plan.change.changeSetId)).changeSet.workspaceId,
        plan.change.destinationPath ?? '',
      );
      if (
        plan.change.baselineHash === undefined ||
        sha256(moved.bytes) !== plan.change.baselineHash
      ) {
        await rename(plan.destinationPath, plan.sourcePath);
        throw new Error(conflictMessage(plan.change));
      }
      return;
    }

    const backupPath = transactionPath(plan.sourcePath, 'backup');
    await rename(plan.sourcePath, backupPath);
    plan.backupPath = backupPath;
    const movedBaseline = await open(backupPath, 'r');
    let actualBaseline: Buffer;
    try {
      actualBaseline = await movedBaseline.readFile();
    } finally {
      await movedBaseline.close();
    }
    if (
      plan.change.baselineHash === undefined ||
      sha256(actualBaseline) !== plan.change.baselineHash
    ) {
      await rename(backupPath, plan.sourcePath);
      plan.backupPath = undefined;
      throw new Error(conflictMessage(plan.change));
    }

    if (plan.change.operation === 'update') {
      if (plan.temporaryPath === undefined) {
        await rename(backupPath, plan.sourcePath);
        plan.backupPath = undefined;
        throw new Error('Prepared update content is missing.');
      }
      try {
        await rename(plan.temporaryPath, plan.sourcePath);
        plan.temporaryPath = undefined;
      } catch (error) {
        await rename(backupPath, plan.sourcePath);
        plan.backupPath = undefined;
        throw error;
      }
    }
  }

  private async compensatePlans(plans: ReadonlyArray<ApplyPlan>): Promise<string | null> {
    const errors: string[] = [];
    for (const plan of [...plans].reverse()) {
      if (!plan.executed) {
        continue;
      }
      try {
        if (plan.change.operation === 'create') {
          const current = await this.paths.existing(
            this.changes.get(plan.change.changeSetId).changeSet.workspaceId,
            plan.change.filePath,
          );
          if (
            plan.change.proposedHash === undefined ||
            sha256(current.bytes) !== plan.change.proposedHash
          ) {
            throw new Error(conflictMessage(plan.change));
          }
          await unlink(plan.sourcePath);
        } else if (plan.change.operation === 'rename') {
          if (plan.destinationPath === undefined) {
            throw new Error('Rename compensation destination is missing.');
          }
          await rename(plan.destinationPath, plan.sourcePath);
        } else if (plan.backupPath !== undefined) {
          if (plan.change.operation === 'update') {
            await unlink(plan.sourcePath);
          }
          await rename(plan.backupPath, plan.sourcePath);
          plan.backupPath = undefined;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Unknown compensation failure.');
      }
    }
    return errors.length === 0 ? null : errors.join(' ');
  }

  private async commitPlans(plans: ReadonlyArray<ApplyPlan>): Promise<void> {
    for (const plan of plans) {
      if (plan.backupPath !== undefined) {
        await unlink(plan.backupPath).catch(() => undefined);
        plan.backupPath = undefined;
      }
    }
    await this.cleanupPlans(plans);
  }

  private async cleanupPlans(plans: ReadonlyArray<ApplyPlan>): Promise<void> {
    for (const plan of plans) {
      if (plan.temporaryPath !== undefined) {
        await unlink(plan.temporaryPath).catch(() => undefined);
        plan.temporaryPath = undefined;
      }
    }
  }
}
