import type { FileChange, FileChangeOperation } from '@open-code-desk/domain';

import type { ToolExecutionContext } from '@open-code-desk/tool-core';
import { ChangeArtifactStore, sha256 } from './artifact-store';
import { applyChangePatch, createChangeDiff } from './change-diff';
import { ChangePathResolver } from './change-path-resolver';
import {
  FileChangeRepository,
  type FileChangeAggregate,
  type NewFileChange,
} from './file-change.repository';
import type { AgentTaskRepository } from '../agent/agent-task.repository';

export type ReviewDecision = 'approve' | 'reject';

function reviewDigest(
  changeSet: FileChangeAggregate['changeSet'],
  input: Pick<
    NewFileChange,
    'filePath' | 'destinationPath' | 'operation' | 'baselineHash' | 'proposedHash'
  >,
): string {
  return sha256(
    JSON.stringify({
      changeSetId: changeSet.id,
      workspaceId: changeSet.workspaceId,
      conversationId: changeSet.conversationId,
      taskId: changeSet.taskId,
      operation: input.operation,
      filePath: input.filePath,
      destinationPath: input.destinationPath ?? null,
      baselineHash: input.baselineHash ?? null,
      proposedHash: input.proposedHash ?? null,
    }),
  );
}

function calculateApplyDigest(changes: ReadonlyArray<FileChange>): string {
  return sha256(
    JSON.stringify(
      changes.map((change) => ({
        id: change.id,
        sequence: change.sequence,
        status: change.status,
        reviewDigest: change.reviewDigest,
      })),
    ),
  );
}

export class FileChangeService {
  public constructor(
    private readonly repository: FileChangeRepository,
    private readonly artifacts: ChangeArtifactStore,
    private readonly paths: ChangePathResolver,
    private readonly tasks: AgentTaskRepository,
  ) {}

  public async proposeCreate(
    context: ToolExecutionContext,
    filePath: string,
    content: string,
  ): Promise<FileChangeAggregate> {
    const target = await this.paths.vacant(context.workspaceId, filePath);
    return this.addProposal(context, {
      operation: 'create',
      filePath: target.relativePath,
      proposedContent: content,
    });
  }

  public async proposeUpdate(
    context: ToolExecutionContext,
    filePath: string,
    content: string,
  ): Promise<FileChangeAggregate> {
    const target = await this.paths.existing(context.workspaceId, filePath);
    if (target.content === content) {
      throw new Error('The proposed content is identical to the workspace baseline.');
    }
    return this.addProposal(context, {
      operation: 'update',
      filePath: target.relativePath,
      originalContent: target.content,
      proposedContent: content,
      baselineHash: sha256(target.bytes),
    });
  }

  public async proposeDelete(
    context: ToolExecutionContext,
    filePath: string,
  ): Promise<FileChangeAggregate> {
    const target = await this.paths.existing(context.workspaceId, filePath);
    return this.addProposal(context, {
      operation: 'delete',
      filePath: target.relativePath,
      originalContent: target.content,
      baselineHash: sha256(target.bytes),
    });
  }

  public async proposeRename(
    context: ToolExecutionContext,
    sourcePath: string,
    destinationPath: string,
  ): Promise<FileChangeAggregate> {
    const source = await this.paths.existing(context.workspaceId, sourcePath);
    const destination = await this.paths.vacant(context.workspaceId, destinationPath);
    return this.addProposal(context, {
      operation: 'rename',
      filePath: source.relativePath,
      destinationPath: destination.relativePath,
      originalContent: source.content,
      proposedContent: source.content,
      baselineHash: sha256(source.bytes),
    });
  }

  public async proposePatch(
    context: ToolExecutionContext,
    filePath: string,
    patch: string,
  ): Promise<FileChangeAggregate> {
    const target = await this.paths.existing(context.workspaceId, filePath);
    const proposedContent = applyChangePatch(target.content, patch);
    if (target.content === proposedContent) {
      throw new Error('The patch does not change the file.');
    }
    return this.addProposal(context, {
      operation: 'update',
      filePath: target.relativePath,
      originalContent: target.content,
      proposedContent,
      baselineHash: sha256(target.bytes),
    });
  }

  public get(changeSetId: string): FileChangeAggregate {
    const aggregate = this.repository.getAggregate(changeSetId);
    if (aggregate === null) {
      throw new Error('File change set was not found.');
    }
    return aggregate;
  }

  public findForTask(taskId: string): FileChangeAggregate | null {
    return this.repository.findSetByTask(taskId);
  }

  public listForConversation(conversationId: string): ReadonlyArray<FileChangeAggregate> {
    return this.repository.listForConversation(conversationId);
  }

  public async getContents(changeId: string): Promise<{
    readonly originalContent: string;
    readonly proposedContent: string;
  }> {
    const change = this.requireChange(changeId);
    return {
      originalContent:
        change.originalArtifactRef === undefined
          ? ''
          : await this.artifacts.getText(change.originalArtifactRef),
      proposedContent:
        change.proposedArtifactRef === undefined
          ? ''
          : await this.artifacts.getText(change.proposedArtifactRef),
    };
  }

  public async editProposal(
    changeId: string,
    expectedReviewDigest: string,
    content: string,
  ): Promise<FileChangeAggregate> {
    const change = this.requireChange(changeId);
    if (change.reviewDigest !== expectedReviewDigest) {
      throw new Error('The reviewed change has changed. Reload it before editing.');
    }
    if (change.operation !== 'create' && change.operation !== 'update') {
      throw new Error('Only create and update proposals have editable content.');
    }
    const aggregate = this.get(change.changeSetId);
    if (!['pending_review', 'ready_to_apply', 'failed'].includes(aggregate.changeSet.status)) {
      throw new Error('This change set can no longer be edited.');
    }
    const originalContent =
      change.originalArtifactRef === undefined
        ? ''
        : await this.artifacts.getText(change.originalArtifactRef);
    const proposedArtifactRef = await this.artifacts.putText(content);
    const proposedHash = sha256(content);
    const nextDigest = reviewDigest(aggregate.changeSet, {
      operation: change.operation,
      filePath: change.filePath,
      ...(change.destinationPath === undefined ? {} : { destinationPath: change.destinationPath }),
      ...(change.baselineHash === undefined ? {} : { baselineHash: change.baselineHash }),
      proposedHash,
    });
    this.repository.updateChange(change.id, {
      status: 'pending',
      proposedArtifactRef,
      proposedHash,
      diff: createChangeDiff(
        change.operation,
        change.filePath,
        originalContent,
        content,
        change.destinationPath,
      ),
      reviewDigest: nextDigest,
      error: null,
    });
    this.repository.updateSet(change.changeSetId, {
      status: 'pending_review',
      applyDigest: null,
      error: null,
    });
    return this.get(change.changeSetId);
  }

  public review(
    changeId: string,
    expectedReviewDigest: string,
    decision: ReviewDecision,
  ): FileChangeAggregate {
    const change = this.requireChange(changeId);
    if (change.reviewDigest !== expectedReviewDigest) {
      throw new Error('The review digest is stale. Reload the change before approving it.');
    }
    const aggregate = this.get(change.changeSetId);
    if (!['pending_review', 'ready_to_apply', 'failed'].includes(aggregate.changeSet.status)) {
      throw new Error('This change set is not open for review.');
    }
    if (['applied', 'rolled_back'].includes(change.status)) {
      throw new Error('This change has already been applied.');
    }
    this.repository.updateChange(change.id, {
      status: decision === 'approve' ? 'approved' : 'rejected',
      error: null,
    });
    return this.refreshReviewState(change.changeSetId);
  }

  public reviewMany(
    changeSetId: string,
    entries: ReadonlyArray<{ readonly changeId: string; readonly reviewDigest: string }>,
    decision: ReviewDecision,
  ): FileChangeAggregate {
    const aggregate = this.get(changeSetId);
    const expected = new Map(entries.map((entry) => [entry.changeId, entry.reviewDigest]));
    if (expected.size !== entries.length || entries.length === 0) {
      throw new Error('Bulk review requires a non-empty, unique list of visible changes.');
    }
    for (const change of aggregate.changes) {
      const digest = expected.get(change.id);
      if (digest === undefined) {
        continue;
      }
      if (digest !== change.reviewDigest) {
        throw new Error(`The review digest for ${change.filePath} is stale.`);
      }
      if (['applied', 'rolled_back'].includes(change.status)) {
        throw new Error(`${change.filePath} is no longer reviewable.`);
      }
    }
    for (const entry of entries) {
      const change = aggregate.changes.find((item) => item.id === entry.changeId);
      if (change === undefined) {
        throw new Error('A bulk review entry does not belong to this change set.');
      }
      this.repository.updateChange(change.id, {
        status: decision === 'approve' ? 'approved' : 'rejected',
        error: null,
      });
    }
    return this.refreshReviewState(changeSetId);
  }

  public expectedApplyDigest(changeSetId: string): string {
    const aggregate = this.get(changeSetId);
    return calculateApplyDigest(aggregate.changes);
  }

  private async addProposal(
    context: ToolExecutionContext,
    input: {
      readonly operation: FileChangeOperation;
      readonly filePath: string;
      readonly destinationPath?: string;
      readonly originalContent?: string;
      readonly proposedContent?: string;
      readonly baselineHash?: string;
    },
  ): Promise<FileChangeAggregate> {
    const set = this.repository.getOrCreateForTask(
      context.workspaceId,
      context.conversationId,
      context.taskId,
    );
    const aggregate = this.get(set.id);
    const conflicts = aggregate.changes.some(
      (change) =>
        change.filePath === input.filePath ||
        change.destinationPath === input.filePath ||
        (input.destinationPath !== undefined &&
          (change.filePath === input.destinationPath ||
            change.destinationPath === input.destinationPath)),
    );
    if (conflicts) {
      throw new Error(
        'A proposal for this path already exists in the current change set. Submit one final mutation per path.',
      );
    }
    const originalArtifactRef =
      input.originalContent === undefined
        ? undefined
        : await this.artifacts.putText(input.originalContent);
    const proposedArtifactRef =
      input.proposedContent === undefined
        ? undefined
        : await this.artifacts.putText(input.proposedContent);
    const proposedHash =
      input.proposedContent === undefined ? undefined : sha256(input.proposedContent);
    const proposalDetails = {
      operation: input.operation,
      filePath: input.filePath,
      ...(input.destinationPath === undefined ? {} : { destinationPath: input.destinationPath }),
      ...(originalArtifactRef === undefined ? {} : { originalArtifactRef }),
      ...(proposedArtifactRef === undefined ? {} : { proposedArtifactRef }),
      ...(input.baselineHash === undefined ? {} : { baselineHash: input.baselineHash }),
      ...(proposedHash === undefined ? {} : { proposedHash }),
      diff: createChangeDiff(
        input.operation,
        input.filePath,
        input.originalContent ?? '',
        input.proposedContent ?? '',
        input.destinationPath,
      ),
    };
    const proposal: NewFileChange = {
      ...proposalDetails,
      reviewDigest: reviewDigest(set, proposalDetails),
    };
    this.repository.add(set.id, proposal);
    this.repository.updateSet(set.id, {
      status: 'pending_review',
      applyDigest: null,
      error: null,
    });
    return this.get(set.id);
  }

  private refreshReviewState(changeSetId: string): FileChangeAggregate {
    const current = this.get(changeSetId);
    const approved = current.changes.some((change) => change.status === 'approved');
    const pending = current.changes.some((change) => change.status === 'pending');
    const applyDigest = calculateApplyDigest(current.changes);
    const readyToApply = approved && !pending;
    this.repository.updateSet(changeSetId, {
      status: readyToApply ? 'ready_to_apply' : pending ? 'pending_review' : 'cancelled',
      applyDigest: readyToApply ? applyDigest : null,
      error: null,
    });
    if (!approved && !pending) {
      this.tasks.update(current.changeSet.taskId, 'completed');
    }
    return this.get(changeSetId);
  }

  private requireChange(changeId: string): FileChange {
    const change = this.repository.findById(changeId);
    if (change === null) {
      throw new Error('File change was not found.');
    }
    return change;
  }
}
