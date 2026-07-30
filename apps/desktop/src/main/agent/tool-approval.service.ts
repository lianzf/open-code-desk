import type {
  AgentTool,
  PermissionApprover,
  ToolExecutionContext,
} from '@open-code-desk/tool-core';

import type { ToolCallRepository } from './tool-call.repository';
import type { ToolApprovalListener, ToolApprovalOutcome } from './tool-approval-lifecycle';

interface PendingToolApproval {
  readonly resolve: (outcome: ToolApprovalOutcome) => void;
  readonly signal: AbortSignal;
  readonly abortListener: () => void;
  readonly workspaceId: string;
  readonly modelCallId: string;
}

export class ToolApprovalService implements PermissionApprover {
  readonly #pending = new Map<string, PendingToolApproval>();
  readonly #listeners = new Map<string, Set<ToolApprovalListener>>();

  public constructor(private readonly toolCalls: ToolCallRepository) {}

  public subscribe(taskId: string, listener: ToolApprovalListener): () => void {
    const listeners = this.#listeners.get(taskId) ?? new Set<ToolApprovalListener>();
    listeners.add(listener);
    this.#listeners.set(taskId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(taskId);
      }
    };
  }

  public request(
    tool: AgentTool,
    input: unknown,
    context: ToolExecutionContext,
    reason: string,
  ): Promise<ToolApprovalOutcome> {
    if (this.#pending.has(context.callId)) {
      throw new Error('This tool call is already waiting for approval.');
    }
    const call = this.toolCalls.recordPending({
      id: context.callId,
      workspaceId: context.workspaceId,
      taskId: context.taskId,
      conversationId: context.conversationId,
      toolName: tool.name,
      permissionLevel: tool.permissionLevel,
      untrustedInput: input,
      reason,
    });

    return new Promise<ToolApprovalOutcome>((resolve) => {
      const abortListener = () => {
        if (!this.#pending.has(context.callId)) {
          return;
        }
        const updated = this.toolCalls.recordApprovalOutcome({
          callId: context.callId,
          workspaceId: context.workspaceId,
          outcome: 'cancelled',
        });
        this.emit(context.taskId, {
          type: 'tool_approval_resolved',
          call: updated,
          modelCallId: context.modelCallId ?? context.callId,
          outcome: 'cancelled',
        });
        this.resolve(context.callId, 'cancelled');
      };
      this.#pending.set(context.callId, {
        resolve,
        signal: context.signal,
        abortListener,
        workspaceId: context.workspaceId,
        modelCallId: context.modelCallId ?? context.callId,
      });
      context.signal.addEventListener('abort', abortListener, { once: true });
      if (context.signal.aborted) {
        abortListener();
        return;
      }
      this.emit(context.taskId, {
        type: 'tool_approval_requested',
        call,
        modelCallId: context.modelCallId ?? context.callId,
        reason,
      });
    });
  }

  public decide(input: {
    readonly callId: string;
    readonly expectedApprovalDigest: string;
    readonly decision: 'approve' | 'reject';
  }): boolean {
    const pending = this.#pending.get(input.callId);
    const call = this.toolCalls.findById(input.callId);
    if (pending === undefined || call === null || call.status !== 'pending') {
      throw new Error('This tool request is no longer waiting for approval.');
    }
    if (call.approvalDigest !== input.expectedApprovalDigest) {
      throw new Error('The tool approval digest is stale.');
    }
    const outcome = input.decision === 'approve' ? 'approved' : 'rejected';
    const updated = this.toolCalls.recordApprovalOutcome({
      callId: input.callId,
      workspaceId: pending.workspaceId,
      outcome,
    });
    this.emit(call.taskId, {
      type: 'tool_approval_resolved',
      call: updated,
      modelCallId: pending.modelCallId,
      outcome,
    });
    this.resolve(input.callId, outcome);
    return true;
  }

  public close(): void {
    for (const callId of [...this.#pending.keys()]) {
      const pending = this.#pending.get(callId);
      if (pending !== undefined) {
        const call = this.toolCalls.recordApprovalOutcome({
          callId,
          workspaceId: pending.workspaceId,
          outcome: 'cancelled',
        });
        this.emit(call.taskId, {
          type: 'tool_approval_resolved',
          call,
          modelCallId: pending.modelCallId,
          outcome: 'cancelled',
        });
        this.resolve(callId, 'cancelled');
      }
    }
    this.#listeners.clear();
  }

  private resolve(callId: string, outcome: ToolApprovalOutcome): void {
    const pending = this.#pending.get(callId);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(callId);
    pending.signal.removeEventListener('abort', pending.abortListener);
    pending.resolve(outcome);
  }

  private emit(taskId: string, event: Parameters<ToolApprovalListener>[0]): void {
    for (const listener of this.#listeners.get(taskId) ?? []) {
      listener(event);
    }
  }
}
