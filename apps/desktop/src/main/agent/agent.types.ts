import type {
  AgentStatus,
  AgentTaskCheckpoint,
  AppError,
  CommandExecution,
  ConversationMessage,
  ToolCallStatus,
} from '@open-code-desk/domain';
import type { ProviderUsage } from '@open-code-desk/provider-core';

export interface AgentRunInput {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly providerId: string;
  readonly model?: string;
  readonly content: string;
}

export type AgentStreamEvent =
  | {
      readonly type: 'agent_status';
      readonly taskId: string;
      readonly status: AgentStatus;
    }
  | {
      readonly type: 'task_plan';
      readonly taskId: string;
      readonly attempt: number;
      readonly checkpoint: AgentTaskCheckpoint;
    }
  | {
      readonly type: 'context_built';
      readonly budget: number;
      readonly usedTokens: number;
      readonly droppedMessages: number;
      readonly summarizedMessages: number;
      readonly selectedContextItems: number;
      readonly droppedContextItems: number;
      readonly truncatedContextItems: number;
    }
  | {
      readonly type: 'assistant_message_start';
      readonly message: ConversationMessage;
    }
  | {
      readonly type: 'text_delta';
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'reasoning_delta';
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'usage';
      readonly messageId: string;
      readonly usage: ProviderUsage;
    }
  | {
      readonly type: 'assistant_message_end';
      readonly message: ConversationMessage;
    }
  | {
      readonly type: 'tool_status';
      readonly callId: string;
      readonly modelCallId: string;
      readonly name: string;
      readonly status: ToolCallStatus;
      readonly input?: unknown;
      readonly outputPreview?: string;
      readonly error?: Readonly<{
        code: string;
        message: string;
        retryable: boolean;
      }>;
    }
  | {
      readonly type: 'tool_approval_requested';
      readonly callId: string;
      readonly modelCallId: string;
      readonly name: string;
      readonly permissionLevel: 'read' | 'write' | 'execute' | 'dangerous';
      readonly input: unknown;
      readonly approvalDigest: string;
      readonly reason: string;
    }
  | {
      readonly type: 'change_set_ready';
      readonly taskId: string;
      readonly conversationId: string;
      readonly changeSetId: string;
      readonly changeCount: number;
    }
  | {
      readonly type: 'command_proposed' | 'command_status';
      readonly command: CommandExecution;
    }
  | {
      readonly type: 'command_output';
      readonly commandId: string;
      readonly taskId: string;
      readonly stream: 'stdout' | 'stderr';
      readonly chunk: string;
    }
  | { readonly type: 'completed'; readonly taskId: string }
  | { readonly type: 'cancelled'; readonly taskId: string }
  | { readonly type: 'error'; readonly taskId?: string; readonly error: AppError };

export type AgentEventListener = (event: AgentStreamEvent) => void;
