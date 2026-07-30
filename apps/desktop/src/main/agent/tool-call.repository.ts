import { eq } from 'drizzle-orm';
import type { ToolCallRecord, ToolCallStatus } from '@open-code-desk/domain';
import type {
  AgentTool,
  ToolExecutionContext,
  ToolExecutionObserver,
  ToolResult,
} from '@open-code-desk/tool-core';

import type { AppDatabase } from '../database/database';
import { toolCalls } from '../database/schema';
import type { AuditLogService } from '../audit/audit-log.service';

type ToolCallRow = typeof toolCalls.$inferSelect;

function toToolCall(row: ToolCallRow): ToolCallRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    conversationId: row.conversationId,
    toolName: row.toolName,
    permissionLevel: row.permissionLevel as ToolCallRecord['permissionLevel'],
    input: row.input,
    status: row.status as ToolCallStatus,
    ...(row.output === null ? {} : { output: row.output }),
    ...(row.error === null
      ? {}
      : {
          error: row.error as unknown as NonNullable<ToolCallRecord['error']>,
        }),
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt }),
    ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ToolCallRepository implements ToolExecutionObserver {
  public constructor(
    private readonly database: AppDatabase,
    private readonly audit?: AuditLogService,
  ) {}

  public async started(
    tool: AgentTool,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<void> {
    const now = new Date().toISOString();
    this.database.orm
      .insert(toolCalls)
      .values({
        id: context.callId,
        taskId: context.taskId,
        conversationId: context.conversationId,
        toolName: tool.name,
        permissionLevel: tool.permissionLevel,
        input,
        status: 'running',
        output: null,
        error: null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: toolCalls.id,
        set: {
          input,
          status: 'running',
          startedAt: now,
          updatedAt: now,
        },
      })
      .run();
    this.audit?.record({
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
      taskId: context.taskId,
      actor: 'agent',
      category: 'tool',
      action: `${tool.name}.execute`,
      outcome: 'started',
      summary: `Agent started tool ${tool.name}.`,
      metadata: {
        callId: context.callId,
        permissionLevel: tool.permissionLevel,
      },
    });
  }

  public async completed(
    tool: AgentTool,
    result: ToolResult<unknown>,
    context: ToolExecutionContext,
  ): Promise<void> {
    const now = new Date().toISOString();
    this.database.orm
      .update(toolCalls)
      .set({
        status: result.ok
          ? 'completed'
          : result.error.code === 'CANCELLED'
            ? 'cancelled'
            : 'failed',
        output: result.ok ? result.value : null,
        error: result.ok ? null : result.error,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(toolCalls.id, context.callId))
      .run();
    this.audit?.record({
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
      taskId: context.taskId,
      actor: 'agent',
      category: 'tool',
      action: `${tool.name}.execute`,
      outcome: result.ok ? 'succeeded' : result.error.code === 'CANCELLED' ? 'cancelled' : 'failed',
      summary: result.ok
        ? `Tool ${tool.name} completed.`
        : `Tool ${tool.name} failed: ${result.error.message}`,
      metadata: {
        callId: context.callId,
        ...(result.ok ? {} : { errorCode: result.error.code }),
      },
    });
  }

  public recordRejected(
    input: {
      readonly id: string;
      readonly workspaceId: string;
      readonly taskId: string;
      readonly conversationId: string;
      readonly toolName: string;
      readonly permissionLevel?: ToolCallRecord['permissionLevel'];
      readonly untrustedInput: unknown;
    },
    error: NonNullable<ToolCallRecord['error']>,
  ): ToolCallRecord {
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(toolCalls)
      .values({
        id: input.id,
        taskId: input.taskId,
        conversationId: input.conversationId,
        toolName: input.toolName,
        permissionLevel: input.permissionLevel ?? 'read',
        input: input.untrustedInput,
        status: 'rejected',
        output: null,
        error,
        startedAt: null,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: toolCalls.id,
        set: { status: 'rejected', error, completedAt: now, updatedAt: now },
      })
      .returning()
      .get();
    this.audit?.record({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      actor: 'agent',
      category: 'tool',
      action: `${input.toolName}.execute`,
      outcome: 'denied',
      summary: `Tool ${input.toolName} was rejected: ${error.message}`,
      metadata: {
        callId: input.id,
        errorCode: error.code,
      },
    });
    return toToolCall(row);
  }

  public listForConversation(conversationId: string): ReadonlyArray<ToolCallRecord> {
    return this.database.orm
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.conversationId, conversationId))
      .orderBy(toolCalls.createdAt)
      .all()
      .map(toToolCall);
  }
}
