import { randomUUID } from 'node:crypto';

import { asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  AppError,
  CommandExecution,
  CommandExecutionStatus,
  CommandRiskLevel,
} from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { commandExecutions } from '../database/schema';

type CommandRow = typeof commandExecutions.$inferSelect;

export interface CreateCommandRecord {
  readonly id?: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly taskId: string;
  readonly modelToolCallId: string;
  readonly toolName: 'run_command' | 'run_tests';
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly riskLevel: CommandRiskLevel;
  readonly riskReasons: ReadonlyArray<string>;
  readonly approvalDigest: string;
  readonly status?: CommandExecutionStatus;
  readonly autoApproved?: boolean;
}

function toCommand(row: CommandRow): CommandExecution {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    conversationId: row.conversationId,
    taskId: row.taskId,
    modelToolCallId: row.modelToolCallId,
    toolName: row.toolName as CommandExecution['toolName'],
    executable: row.executable,
    args: row.args,
    cwd: row.cwd,
    timeoutMs: row.timeoutMs,
    riskLevel: row.riskLevel as CommandRiskLevel,
    riskReasons: row.riskReasons,
    approvalDigest: row.approvalDigest,
    status: row.status as CommandExecutionStatus,
    autoApproved: row.autoApproved,
    outputTail: row.outputTail,
    outputBytes: row.outputBytes,
    ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
    ...(row.terminationSignal === null ? {} : { terminationSignal: row.terminationSignal }),
    ...(row.error === null ? {} : { error: row.error as unknown as AppError }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.approvedAt === null ? {} : { approvedAt: row.approvedAt }),
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt }),
    ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
  };
}

export class CommandRepository {
  public constructor(private readonly database: AppDatabase) {}

  public create(input: CreateCommandRecord): CommandExecution {
    const now = new Date().toISOString();
    return toCommand(
      this.database.orm
        .insert(commandExecutions)
        .values({
          id: input.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          taskId: input.taskId,
          modelToolCallId: input.modelToolCallId,
          toolName: input.toolName,
          executable: input.executable,
          args: input.args,
          cwd: input.cwd,
          timeoutMs: input.timeoutMs,
          riskLevel: input.riskLevel,
          riskReasons: input.riskReasons,
          approvalDigest: input.approvalDigest,
          status: input.status ?? 'pending_approval',
          autoApproved: input.autoApproved ?? false,
          outputTail: '',
          outputBytes: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
  }

  public findById(commandId: string): CommandExecution | null {
    const row = this.database.orm
      .select()
      .from(commandExecutions)
      .where(eq(commandExecutions.id, commandId))
      .get();
    return row === undefined ? null : toCommand(row);
  }

  public listForConversation(conversationId: string): ReadonlyArray<CommandExecution> {
    return this.database.orm
      .select()
      .from(commandExecutions)
      .where(eq(commandExecutions.conversationId, conversationId))
      .orderBy(asc(commandExecutions.createdAt))
      .limit(1_000)
      .all()
      .map(toCommand);
  }

  public latestForTask(taskId: string): CommandExecution | null {
    const row = this.database.orm
      .select()
      .from(commandExecutions)
      .where(eq(commandExecutions.taskId, taskId))
      .orderBy(desc(commandExecutions.createdAt))
      .limit(1)
      .get();
    return row === undefined ? null : toCommand(row);
  }

  public update(
    commandId: string,
    update: Partial<{
      status: CommandExecutionStatus;
      autoApproved: boolean;
      outputTail: string;
      outputBytes: number;
      exitCode: number | null;
      terminationSignal: string | null;
      error: AppError | null;
      approvedAt: string | null;
      startedAt: string | null;
      completedAt: string | null;
    }>,
  ): CommandExecution {
    const { error, ...databaseUpdate } = update;
    const row = this.database.orm
      .update(commandExecutions)
      .set({
        ...databaseUpdate,
        ...(error === undefined ? {} : { error: error === null ? null : { ...error } }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(commandExecutions.id, commandId))
      .returning()
      .get();
    if (row === undefined) {
      throw new Error('Command execution was not found.');
    }
    return toCommand(row);
  }

  public recoverInterrupted(): number {
    const now = new Date().toISOString();
    const result = this.database.orm
      .update(commandExecutions)
      .set({
        status: 'cancelled',
        error: {
          code: 'CANCELLED',
          message: 'The application closed before this command completed. Run it again if needed.',
          retryable: true,
        },
        updatedAt: now,
        completedAt: now,
      })
      .where(inArray(commandExecutions.status, ['pending_approval', 'approved', 'running']))
      .run();
    return Number(result.changes);
  }
}
