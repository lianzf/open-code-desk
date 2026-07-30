import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, max } from 'drizzle-orm';
import type { AgentStatus, AgentTask, AppError } from '@open-code-desk/domain';

import type { AppDatabase } from '../database/database';
import { agentTasks } from '../database/schema';

type AgentTaskRow = typeof agentTasks.$inferSelect;

const terminalStatuses: ReadonlyArray<AgentStatus> = ['completed', 'failed', 'cancelled'] as const;

function toAgentTask(row: AgentTaskRow): AgentTask {
  return {
    id: row.id,
    conversationId: row.conversationId,
    requestId: row.requestId,
    status: row.status as AgentStatus,
    attempt: row.attempt,
    ...(row.checkpoint === null ? {} : { checkpoint: row.checkpoint }),
    ...(row.error === null ? {} : { error: row.error as unknown as AppError }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
  };
}

export class AgentTaskRepository {
  public constructor(private readonly database: AppDatabase) {}

  public create(conversationId: string, requestId: string): AgentTask {
    const latestAttempt =
      this.database.orm
        .select({ value: max(agentTasks.attempt) })
        .from(agentTasks)
        .where(eq(agentTasks.conversationId, conversationId))
        .get()?.value ?? 0;
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(agentTasks)
      .values({
        id: randomUUID(),
        conversationId,
        requestId,
        status: 'analyzing',
        attempt: latestAttempt + 1,
        checkpoint: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      })
      .returning()
      .get();
    return toAgentTask(row);
  }

  public findByRequestId(requestId: string): AgentTask | null {
    const row = this.database.orm
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.requestId, requestId))
      .get();
    return row === undefined ? null : toAgentTask(row);
  }

  public latestForConversation(conversationId: string): AgentTask | null {
    const row = this.database.orm
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.conversationId, conversationId))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1)
      .get();
    return row === undefined ? null : toAgentTask(row);
  }

  public update(
    taskId: string,
    status: AgentStatus,
    options: {
      readonly checkpoint?: Readonly<Record<string, unknown>>;
      readonly error?: AppError;
    } = {},
  ): AgentTask | null {
    const now = new Date().toISOString();
    const terminal = terminalStatuses.includes(status);
    const row = this.database.orm
      .update(agentTasks)
      .set({
        status,
        checkpoint: options.checkpoint ?? null,
        error: options.error === undefined ? null : { ...options.error },
        updatedAt: now,
        completedAt: terminal ? now : null,
      })
      .where(eq(agentTasks.id, taskId))
      .returning()
      .get();
    return row === undefined ? null : toAgentTask(row);
  }

  public recoverInterrupted(): number {
    const interruptedStatuses: ReadonlyArray<AgentStatus> = [
      'analyzing',
      'planning',
      'waiting_for_approval',
      'executing_tool',
      'editing_files',
      'running_tests',
    ];
    const now = new Date().toISOString();
    const result = this.database.orm
      .update(agentTasks)
      .set({
        status: 'failed',
        error: {
          code: 'UNKNOWN_ERROR',
          message: 'The application closed before this task completed. Retry to continue.',
          retryable: true,
        },
        updatedAt: now,
        completedAt: now,
      })
      .where(inArray(agentTasks.status, interruptedStatuses))
      .run();
    return Number(result.changes);
  }

  public isActive(conversationId: string): boolean {
    const activeStatuses: ReadonlyArray<AgentStatus> = [
      'analyzing',
      'planning',
      'waiting_for_approval',
      'executing_tool',
      'editing_files',
      'running_tests',
    ];
    return (
      this.database.orm
        .select({ id: agentTasks.id })
        .from(agentTasks)
        .where(
          and(
            eq(agentTasks.conversationId, conversationId),
            inArray(agentTasks.status, activeStatuses),
          ),
        )
        .limit(1)
        .get() !== undefined
    );
  }
}
