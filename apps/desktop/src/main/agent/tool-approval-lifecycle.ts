import { createHash } from 'node:crypto';

import type { ToolCallRecord } from '@open-code-desk/domain';

export type ToolApprovalOutcome = 'approved' | 'rejected' | 'cancelled';

export interface ToolApprovalRequestedEvent {
  readonly type: 'tool_approval_requested';
  readonly call: ToolCallRecord;
  readonly modelCallId: string;
  readonly reason: string;
}

export interface ToolApprovalResolvedEvent {
  readonly type: 'tool_approval_resolved';
  readonly call: ToolCallRecord;
  readonly modelCallId: string;
  readonly outcome: ToolApprovalOutcome;
}

export type ToolApprovalEvent = ToolApprovalRequestedEvent | ToolApprovalResolvedEvent;
export type ToolApprovalListener = (event: ToolApprovalEvent) => void;

export function toolApprovalDigest(input: {
  readonly id: string;
  readonly taskId: string;
  readonly conversationId: string;
  readonly toolName: string;
  readonly permissionLevel: ToolCallRecord['permissionLevel'];
  readonly toolInput: unknown;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
