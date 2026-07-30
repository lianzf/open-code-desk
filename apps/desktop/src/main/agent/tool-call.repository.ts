import { eq, inArray } from 'drizzle-orm';
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
import { toolApprovalDigest } from './tool-approval-lifecycle';

type ToolCallRow = typeof toolCalls.$inferSelect;

function toToolCall(row: ToolCallRow): ToolCallRecord {
  const approvalDigest =
    row.status === 'pending'
      ? toolApprovalDigest({
          id: row.id,
          taskId: row.taskId,
          conversationId: row.conversationId,
          toolName: row.toolName,
          permissionLevel: row.permissionLevel as ToolCallRecord['permissionLevel'],
          toolInput: row.input,
        })
      : undefined;
  return {
    id: row.id,
    taskId: row.taskId,
    conversationId: row.conversationId,
    toolName: row.toolName,
    permissionLevel: row.permissionLevel as ToolCallRecord['permissionLevel'],
    input: row.input,
    status: row.status as ToolCallStatus,
    ...(approvalDigest === undefined ? {} : { approvalDigest }),
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
          output: null,
          error: null,
          startedAt: now,
          completedAt: null,
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

  public recordPending(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly taskId: string;
    readonly conversationId: string;
    readonly toolName: string;
    readonly permissionLevel: ToolCallRecord['permissionLevel'];
    readonly untrustedInput: unknown;
    readonly reason: string;
  }): ToolCallRecord {
    const now = new Date().toISOString();
    const row = this.database.orm
      .insert(toolCalls)
      .values({
        id: input.id,
        taskId: input.taskId,
        conversationId: input.conversationId,
        toolName: input.toolName,
        permissionLevel: input.permissionLevel,
        input: input.untrustedInput,
        status: 'pending',
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: toolCalls.id,
        set: {
          input: input.untrustedInput,
          permissionLevel: input.permissionLevel,
          status: 'pending',
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
          updatedAt: now,
        },
      })
      .returning()
      .get();
    this.audit?.record({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      actor: 'agent',
      category: 'permission',
      action: `${input.toolName}.approve`,
      outcome: 'requested',
      summary: `Tool ${input.toolName} requested user approval.`,
      metadata: {
        callId: input.id,
        permissionLevel: input.permissionLevel,
        reason: input.reason.slice(0, 500),
      },
    });
    return toToolCall(row);
  }

  public findById(callId: string): ToolCallRecord | null {
    const row = this.database.orm.select().from(toolCalls).where(eq(toolCalls.id, callId)).get();
    return row === undefined ? null : toToolCall(row);
  }

  public recordApprovalOutcome(input: {
    readonly callId: string;
    readonly workspaceId: string;
    readonly outcome: 'approved' | 'rejected' | 'cancelled';
  }): ToolCallRecord {
    const current = this.findById(input.callId);
    if (current === null) {
      throw new Error('Tool approval request was not found.');
    }
    const now = new Date().toISOString();
    const terminal = input.outcome !== 'approved';
    const error =
      input.outcome === 'approved'
        ? null
        : {
            code: input.outcome === 'cancelled' ? 'CANCELLED' : 'TOOL_APPROVAL_REJECTED',
            message:
              input.outcome === 'cancelled'
                ? 'Tool approval was cancelled.'
                : 'The user rejected the tool request.',
            retryable: true,
          };
    const row = this.database.orm
      .update(toolCalls)
      .set({
        status:
          input.outcome === 'approved'
            ? 'pending'
            : input.outcome === 'cancelled'
              ? 'cancelled'
              : 'rejected',
        error,
        completedAt: terminal ? now : null,
        updatedAt: now,
      })
      .where(eq(toolCalls.id, input.callId))
      .returning()
      .get();
    if (row === undefined) {
      throw new Error('Tool approval request was not found.');
    }
    this.audit?.record({
      workspaceId: input.workspaceId,
      conversationId: current.conversationId,
      taskId: current.taskId,
      actor: input.outcome === 'cancelled' ? 'system' : 'user',
      category: 'permission',
      action: `${current.toolName}.approve`,
      outcome:
        input.outcome === 'approved'
          ? 'allowed'
          : input.outcome === 'cancelled'
            ? 'cancelled'
            : 'denied',
      summary: `Tool ${current.toolName} approval was ${input.outcome}.`,
      metadata: {
        callId: current.id,
        permissionLevel: current.permissionLevel,
      },
    });
    return toToolCall(row);
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

  public recoverInterrupted(): number {
    const now = new Date().toISOString();
    const result = this.database.orm
      .update(toolCalls)
      .set({
        status: 'cancelled',
        error: {
          code: 'CANCELLED',
          message: 'The application closed before this tool call completed. Retry the task.',
          retryable: true,
        },
        completedAt: now,
        updatedAt: now,
      })
      .where(inArray(toolCalls.status, ['pending', 'running']))
      .run();
    return Number(result.changes);
  }
}
