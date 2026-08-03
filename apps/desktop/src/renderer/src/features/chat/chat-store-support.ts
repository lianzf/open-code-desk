import type {
  AgentTaskCheckpoint,
  Conversation,
  ToolCallRecord,
} from '@open-code-desk/ipc-contracts';

import { useProviderStore } from '@/features/providers/provider.store';
import { rendererError, rendererErrorDetail, rendererErrorMessage } from '../settings/error-i18n';

export type ChatMessageStatus = 'complete' | 'streaming' | 'error' | 'cancelled';

export interface DisplayChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly reasoning: string;
  readonly status: ChatMessageStatus;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface DisplayToolActivity {
  readonly id: string;
  readonly name: string;
  readonly status: ToolCallRecord['status'];
  readonly input?: unknown;
  readonly outputPreview?: string;
  readonly errorMessage?: string;
  readonly permissionLevel?: ToolCallRecord['permissionLevel'];
  readonly approvalDigest?: string;
  readonly approvalReason?: string;
}

export interface ContextStats {
  readonly budget: number;
  readonly usedTokens: number;
  readonly droppedMessages: number;
  readonly summarizedMessages: number;
  readonly selectedContextItems: number;
  readonly droppedContextItems: number;
  readonly truncatedContextItems: number;
}

export interface ChatState {
  readonly workspaceId: string | undefined;
  readonly activeRequestId: string | undefined;
  readonly activeConversationId: string | undefined;
  readonly agentStatus:
    | 'idle'
    | 'analyzing'
    | 'planning'
    | 'waiting_for_approval'
    | 'executing_tool'
    | 'editing_files'
    | 'running_tests'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly conversations: ReadonlyArray<Conversation>;
  readonly conversationQuery: string;
  readonly contextStats: ContextStats | undefined;
  readonly taskPlan: AgentTaskCheckpoint | undefined;
  readonly taskAttempt: number | undefined;
  readonly errorMessage: string | undefined;
  readonly messages: ReadonlyArray<DisplayChatMessage>;
  readonly toolActivity: ReadonlyArray<DisplayToolActivity>;
  bindStream(): () => void;
  initialize(workspaceId: string): Promise<void>;
  newConversation(): Promise<void>;
  selectConversation(conversationId: string): Promise<void>;
  renameActive(title: string): Promise<void>;
  deleteActive(): Promise<void>;
  exportActive(): Promise<void>;
  regenerate(): Promise<void>;
  searchConversations(query: string): Promise<void>;
  send(content: string): Promise<void>;
  stop(): Promise<void>;
}

export function readableChatError(error: unknown): string {
  return rendererErrorMessage(error, 'chatOperationFailed');
}

export function toToolActivity(toolCall: ToolCallRecord): DisplayToolActivity {
  let outputPreview: string | undefined;
  if (toolCall.output !== undefined) {
    try {
      outputPreview = JSON.stringify(toolCall.output).slice(0, 2_000);
    } catch {
      outputPreview = rendererError('toolResultUnavailable');
    }
  }
  return {
    id: toolCall.id,
    name: toolCall.toolName,
    status: toolCall.status,
    input: toolCall.input,
    ...(outputPreview === undefined ? {} : { outputPreview }),
    ...(toolCall.error === undefined
      ? {}
      : {
          errorMessage: rendererErrorDetail(
            toolCall.error.message,
            toolCall.error.code,
            'chatOperationFailed',
          ),
        }),
    permissionLevel: toolCall.permissionLevel,
    ...(toolCall.approvalDigest === undefined ? {} : { approvalDigest: toolCall.approvalDigest }),
  };
}

export function selectedProviderInput(openSettings = false): {
  readonly providerId: string;
  readonly model: string;
} | null {
  const state = useProviderStore.getState();
  const providerId = state.selectedProviderId;
  const configuration = state.configurations.find((item) => item.id === providerId);
  if (providerId === undefined || configuration === undefined) {
    if (openSettings) state.openSettings();
    return null;
  }
  return {
    providerId,
    model: state.selectedModels[providerId] ?? configuration.defaultModel,
  };
}
