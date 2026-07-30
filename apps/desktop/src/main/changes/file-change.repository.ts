import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  FileChange,
  FileChangeOperation,
  FileChangeSet,
  FileChangeSetStatus,
  FileChangeStatus,
} from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { fileChanges, fileChangeSets } from '../database/schema';

type FileChangeRow = typeof fileChanges.$inferSelect;
type FileChangeSetRow = typeof fileChangeSets.$inferSelect;

export interface FileChangeAggregate {
  readonly changeSet: FileChangeSet;
  readonly changes: ReadonlyArray<FileChange>;
}

export interface NewFileChange {
  readonly filePath: string;
  readonly destinationPath?: string;
  readonly operation: FileChangeOperation;
  readonly originalArtifactRef?: string;
  readonly proposedArtifactRef?: string;
  readonly baselineHash?: string;
  readonly proposedHash?: string;
  readonly diff: string;
  readonly reviewDigest: string;
}

function toChangeSet(row: FileChangeSetRow): FileChangeSet {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    conversationId: row.conversationId,
    taskId: row.taskId,
    title: row.title,
    status: row.status as FileChangeSetStatus,
    ...(row.applyDigest === null ? {} : { applyDigest: row.applyDigest }),
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.appliedAt === null ? {} : { appliedAt: row.appliedAt }),
    ...(row.rolledBackAt === null ? {} : { rolledBackAt: row.rolledBackAt }),
  };
}

function toChange(row: FileChangeRow): FileChange {
  return {
    id: row.id,
    changeSetId: row.changeSetId,
    sequence: row.sequence,
    filePath: row.filePath,
    ...(row.destinationPath === null ? {} : { destinationPath: row.destinationPath }),
    operation: row.operation as FileChangeOperation,
    ...(row.originalArtifactRef === null ? {} : { originalArtifactRef: row.originalArtifactRef }),
    ...(row.proposedArtifactRef === null ? {} : { proposedArtifactRef: row.proposedArtifactRef }),
    ...(row.snapshotArtifactRef === null ? {} : { snapshotArtifactRef: row.snapshotArtifactRef }),
    ...(row.baselineHash === null ? {} : { baselineHash: row.baselineHash }),
    ...(row.proposedHash === null ? {} : { proposedHash: row.proposedHash }),
    ...(row.appliedHash === null ? {} : { appliedHash: row.appliedHash }),
    diff: row.diff,
    reviewDigest: row.reviewDigest,
    status: row.status as FileChangeStatus,
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.appliedAt === null ? {} : { appliedAt: row.appliedAt }),
    ...(row.rolledBackAt === null ? {} : { rolledBackAt: row.rolledBackAt }),
  };
}

export class FileChangeRepository {
  public constructor(private readonly database: AppDatabase) {}

  public getOrCreateForTask(
    workspaceId: string,
    conversationId: string,
    taskId: string,
  ): FileChangeSet {
    const existing = this.database.orm
      .select()
      .from(fileChangeSets)
      .where(
        and(
          eq(fileChangeSets.taskId, taskId),
          inArray(fileChangeSets.status, ['pending_review', 'ready_to_apply']),
        ),
      )
      .get();
    if (existing !== undefined) {
      return toChangeSet(existing);
    }
    const now = new Date().toISOString();
    return toChangeSet(
      this.database.orm
        .insert(fileChangeSets)
        .values({
          id: randomUUID(),
          workspaceId,
          conversationId,
          taskId,
          title: 'AI proposed code changes',
          status: 'pending_review',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
  }

  public add(changeSetId: string, input: NewFileChange): FileChange {
    const latest = this.database.orm
      .select({ sequence: fileChanges.sequence })
      .from(fileChanges)
      .where(eq(fileChanges.changeSetId, changeSetId))
      .orderBy(desc(fileChanges.sequence))
      .limit(1)
      .get();
    const now = new Date().toISOString();
    return toChange(
      this.database.orm
        .insert(fileChanges)
        .values({
          id: randomUUID(),
          changeSetId,
          sequence: (latest?.sequence ?? 0) + 1,
          filePath: input.filePath,
          destinationPath: input.destinationPath ?? null,
          operation: input.operation,
          originalArtifactRef: input.originalArtifactRef ?? null,
          proposedArtifactRef: input.proposedArtifactRef ?? null,
          baselineHash: input.baselineHash ?? null,
          proposedHash: input.proposedHash ?? null,
          diff: input.diff,
          reviewDigest: input.reviewDigest,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
  }

  public findById(changeId: string): FileChange | null {
    const row = this.database.orm
      .select()
      .from(fileChanges)
      .where(eq(fileChanges.id, changeId))
      .get();
    return row === undefined ? null : toChange(row);
  }

  public findSetByTask(taskId: string): FileChangeAggregate | null {
    const row = this.database.orm
      .select()
      .from(fileChangeSets)
      .where(eq(fileChangeSets.taskId, taskId))
      .orderBy(desc(fileChangeSets.updatedAt))
      .limit(1)
      .get();
    return row === undefined ? null : this.getAggregate(row.id);
  }

  public getAggregate(changeSetId: string): FileChangeAggregate | null {
    const setRow = this.database.orm
      .select()
      .from(fileChangeSets)
      .where(eq(fileChangeSets.id, changeSetId))
      .get();
    if (setRow === undefined) {
      return null;
    }
    const changeRows = this.database.orm
      .select()
      .from(fileChanges)
      .where(eq(fileChanges.changeSetId, changeSetId))
      .orderBy(asc(fileChanges.sequence))
      .all();
    return { changeSet: toChangeSet(setRow), changes: changeRows.map(toChange) };
  }

  public listForConversation(conversationId: string): ReadonlyArray<FileChangeAggregate> {
    return this.database.orm
      .select()
      .from(fileChangeSets)
      .where(eq(fileChangeSets.conversationId, conversationId))
      .orderBy(desc(fileChangeSets.updatedAt))
      .limit(100)
      .all()
      .map((row) => this.getAggregate(row.id))
      .filter((item): item is FileChangeAggregate => item !== null);
  }

  public listInterrupted(): ReadonlyArray<FileChangeAggregate> {
    return this.database.orm
      .select()
      .from(fileChangeSets)
      .where(inArray(fileChangeSets.status, ['applying', 'rolling_back']))
      .all()
      .map((row) => this.getAggregate(row.id))
      .filter((item): item is FileChangeAggregate => item !== null);
  }

  public updateChange(
    changeId: string,
    update: Partial<{
      status: FileChangeStatus;
      proposedArtifactRef: string | null;
      snapshotArtifactRef: string | null;
      proposedHash: string | null;
      appliedHash: string | null;
      diff: string;
      reviewDigest: string;
      error: string | null;
      appliedAt: string | null;
      rolledBackAt: string | null;
    }>,
  ): FileChange {
    const row = this.database.orm
      .update(fileChanges)
      .set({ ...update, updatedAt: new Date().toISOString() })
      .where(eq(fileChanges.id, changeId))
      .returning()
      .get();
    if (row === undefined) {
      throw new Error('File change was not found.');
    }
    return toChange(row);
  }

  public updateSet(
    changeSetId: string,
    update: Partial<{
      status: FileChangeSetStatus;
      applyDigest: string | null;
      error: string | null;
      appliedAt: string | null;
      rolledBackAt: string | null;
    }>,
  ): FileChangeSet {
    const row = this.database.orm
      .update(fileChangeSets)
      .set({ ...update, updatedAt: new Date().toISOString() })
      .where(eq(fileChangeSets.id, changeSetId))
      .returning()
      .get();
    if (row === undefined) {
      throw new Error('File change set was not found.');
    }
    return toChangeSet(row);
  }
}
