import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type {
  RunApprovalDecision,
  RunCommandSnapshot,
  RunExecution,
  RunExecutionError,
  RunRiskLevel,
  RunStatus,
} from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { runExecutions } from '../database/schema';

type RunExecutionRow = typeof runExecutions.$inferSelect;

export interface CreateRunExecutionInput {
  readonly id?: string;
  readonly workspaceId: string;
  readonly configurationId: string;
  readonly restartOfExecutionId?: string;
  readonly command: RunCommandSnapshot;
  readonly status?: RunStatus;
  readonly riskLevel: RunRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
  readonly approvalDigest: string;
  readonly approvalDecision?: RunApprovalDecision;
  readonly processId?: number;
  readonly outputTail?: string;
  readonly outputBytes?: number;
  readonly outputTruncated?: boolean;
  readonly exitCode?: number;
  readonly terminationSignal?: string;
  readonly error?: RunExecutionError;
  readonly approvalDecidedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface UpdateRunExecutionInput {
  readonly status?: RunStatus;
  readonly approvalDecision?: RunApprovalDecision | null;
  readonly processId?: number | null;
  readonly outputTail?: string;
  readonly outputBytes?: number;
  readonly outputTruncated?: boolean;
  readonly exitCode?: number | null;
  readonly terminationSignal?: string | null;
  readonly error?: RunExecutionError | null;
  readonly approvalDecidedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

export interface ListRunExecutionsOptions {
  readonly configurationId?: string;
  readonly limit?: number;
}

function assertSafeSnapshot(configurationId: string, command: RunCommandSnapshot): void {
  if (command.configurationId !== configurationId) {
    throw new Error('The command snapshot must belong to the execution configuration.');
  }
  for (const variable of command.environmentVariables) {
    if (variable.sensitive && variable.value !== undefined) {
      throw new Error(`Sensitive run environment variable ${variable.name} cannot be persisted.`);
    }
  }
}

function toExecution(row: RunExecutionRow): RunExecution {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    configurationId: row.configurationId,
    ...(row.restartOfExecutionId === null
      ? {}
      : { restartOfExecutionId: row.restartOfExecutionId }),
    command: row.commandSnapshot,
    status: row.status,
    riskLevel: row.riskLevel,
    riskReasons: row.riskReasons,
    approvalDigest: row.approvalDigest,
    ...(row.approvalDecision === null ? {} : { approvalDecision: row.approvalDecision }),
    ...(row.processId === null ? {} : { processId: row.processId }),
    outputTail: row.outputTail,
    outputBytes: row.outputBytes,
    outputTruncated: row.outputTruncated,
    ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
    ...(row.terminationSignal === null ? {} : { terminationSignal: row.terminationSignal }),
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.approvalDecidedAt === null ? {} : { approvalDecidedAt: row.approvalDecidedAt }),
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt }),
    ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 100;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Run history limit must be an integer between 1 and 1000.');
  }
  return limit;
}

export class RunExecutionRepository {
  public constructor(private readonly database: AppDatabase) {}

  public create(input: CreateRunExecutionInput): RunExecution {
    assertSafeSnapshot(input.configurationId, input.command);
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(runExecutions)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: input.workspaceId,
        configurationId: input.configurationId,
        restartOfExecutionId: input.restartOfExecutionId ?? null,
        commandSnapshot: input.command,
        status: input.status ?? 'pending_approval',
        riskLevel: input.riskLevel,
        riskReasons: input.riskReasons,
        approvalDigest: input.approvalDigest,
        approvalDecision: input.approvalDecision ?? null,
        processId: input.processId ?? null,
        outputTail: input.outputTail ?? '',
        outputBytes: input.outputBytes ?? 0,
        outputTruncated: input.outputTruncated ?? false,
        exitCode: input.exitCode ?? null,
        terminationSignal: input.terminationSignal ?? null,
        error: input.error ?? null,
        createdAt: now,
        updatedAt: now,
        approvalDecidedAt: input.approvalDecidedAt ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
      })
      .returning()
      .get();
    return toExecution(row);
  }

  public findById(executionId: string): RunExecution | null {
    const row = this.database.orm
      .select()
      .from(runExecutions)
      .where(eq(runExecutions.id, executionId))
      .get();
    return row === undefined ? null : toExecution(row);
  }

  public list(
    workspaceId: string,
    options: ListRunExecutionsOptions = {},
  ): ReadonlyArray<RunExecution> {
    const condition =
      options.configurationId === undefined
        ? eq(runExecutions.workspaceId, workspaceId)
        : and(
            eq(runExecutions.workspaceId, workspaceId),
            eq(runExecutions.configurationId, options.configurationId),
          );
    return this.database.orm
      .select()
      .from(runExecutions)
      .where(condition)
      .orderBy(desc(runExecutions.createdAt), desc(runExecutions.id))
      .limit(normalizeLimit(options.limit))
      .all()
      .map(toExecution);
  }

  public update(executionId: string, update: UpdateRunExecutionInput): RunExecution {
    const row = this.database.orm
      .update(runExecutions)
      .set({
        ...update,
        error:
          update.error === undefined
            ? undefined
            : update.error === null
              ? null
              : { ...update.error },
        updatedAt: new Date().toISOString(),
      })
      .where(eq(runExecutions.id, executionId))
      .returning()
      .get();
    if (row === undefined) {
      throw new Error('Run execution was not found.');
    }
    return toExecution(row);
  }

  public recoverInterrupted(): number {
    const now = new Date().toISOString();
    this.database.client.exec('BEGIN IMMEDIATE;');
    try {
      const pending = this.database.orm
        .update(runExecutions)
        .set({ processId: null, updatedAt: now })
        .where(
          and(eq(runExecutions.status, 'pending_approval'), isNotNull(runExecutions.processId)),
        )
        .run();
      const failed = this.database.orm
        .update(runExecutions)
        .set({
          status: 'failed',
          processId: null,
          error: {
            code: 'RUN_INTERRUPTED',
            message:
              'The application closed before this run completed. Start the configuration again.',
            retryable: true,
          },
          updatedAt: now,
          completedAt: now,
        })
        .where(inArray(runExecutions.status, ['starting', 'running']))
        .run();
      const stopped = this.database.orm
        .update(runExecutions)
        .set({
          status: 'stopped',
          processId: null,
          updatedAt: now,
          completedAt: now,
        })
        .where(eq(runExecutions.status, 'stopping'))
        .run();
      this.database.client.exec('COMMIT;');
      return Number(pending.changes) + Number(failed.changes) + Number(stopped.changes);
    } catch (error) {
      this.database.client.exec('ROLLBACK;');
      throw error;
    }
  }
}
