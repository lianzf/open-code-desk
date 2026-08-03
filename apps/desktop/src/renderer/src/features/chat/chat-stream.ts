import type { ChatStreamEvent, ConversationMessage } from '@open-code-desk/ipc-contracts';

import type {
  ChatMessageStatus,
  ChatState,
  DisplayChatMessage,
  DisplayToolActivity,
} from './chat.store';
import { useChangeReviewStore } from '@/features/changes/change-review.store';
import { useCommandStore } from '@/features/commands/command.store';
import { rendererErrorDetail } from '@/features/settings/error-i18n';

type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;

export function toDisplayMessage(message: ConversationMessage): DisplayChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
    status: message.status,
  };
}

function updateMessage(
  messages: ReadonlyArray<DisplayChatMessage>,
  messageId: string,
  update: (message: DisplayChatMessage) => DisplayChatMessage,
): ReadonlyArray<DisplayChatMessage> {
  return messages.map((message) => (message.id === messageId ? update(message) : message));
}

function updateLatestStreaming(
  messages: ReadonlyArray<DisplayChatMessage>,
  status: ChatMessageStatus,
): ReadonlyArray<DisplayChatMessage> {
  const target = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.status === 'streaming');
  return target === undefined
    ? messages
    : updateMessage(messages, target.id, (message) => ({ ...message, status }));
}

export function handleStreamEvent(
  streamEvent: ChatStreamEvent,
  set: ChatStoreSet,
  get: () => ChatState,
): void {
  const event = streamEvent.event;
  if (event.type === 'agent_status') {
    set({ agentStatus: event.status });
  } else if (event.type === 'task_plan') {
    set({ taskPlan: event.checkpoint, taskAttempt: event.attempt });
  } else if (event.type === 'context_built') {
    set({
      contextStats: {
        budget: event.budget,
        usedTokens: event.usedTokens,
        droppedMessages: event.droppedMessages,
        summarizedMessages: event.summarizedMessages,
        selectedContextItems: event.selectedContextItems,
        droppedContextItems: event.droppedContextItems,
        truncatedContextItems: event.truncatedContextItems,
      },
    });
  } else if (event.type === 'assistant_message_start') {
    const display = toDisplayMessage(event.message);
    if (display !== null) {
      set((state) => ({ messages: [...state.messages, display] }));
    }
  } else if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
    set((state) => ({
      messages: updateMessage(state.messages, event.messageId, (message) => ({
        ...message,
        ...(event.type === 'text_delta'
          ? { content: message.content + event.delta }
          : { reasoning: message.reasoning + event.delta }),
      })),
    }));
  } else if (event.type === 'usage') {
    set((state) => ({
      messages: updateMessage(state.messages, event.messageId, (message) => ({
        ...message,
        usage: event.usage,
      })),
    }));
  } else if (event.type === 'assistant_message_end') {
    const display = toDisplayMessage(event.message);
    if (display !== null) {
      set((state) => ({
        messages: updateMessage(state.messages, display.id, (existing) => ({
          ...display,
          ...(existing.usage === undefined ? {} : { usage: existing.usage }),
        })),
      }));
    }
  } else if (event.type === 'tool_status') {
    set((state) => {
      const existing = state.toolActivity.find((tool) => tool.id === event.callId);
      const next: DisplayToolActivity = {
        id: event.callId,
        name: event.name,
        status: event.status,
        ...(event.input === undefined
          ? existing?.input === undefined
            ? {}
            : { input: existing.input }
          : { input: event.input }),
        ...(event.outputPreview === undefined ? {} : { outputPreview: event.outputPreview }),
        ...(event.error === undefined
          ? {}
          : {
              errorMessage: rendererErrorDetail(
                event.error.message,
                event.error.code,
                'chatOperationFailed',
              ),
            }),
      };
      return {
        toolActivity:
          existing === undefined
            ? [...state.toolActivity, next]
            : state.toolActivity.map((tool) => (tool.id === next.id ? next : tool)),
      };
    });
  } else if (event.type === 'tool_approval_requested') {
    set((state) => {
      const existing = state.toolActivity.find((tool) => tool.id === event.callId);
      const next: DisplayToolActivity = {
        id: event.callId,
        name: event.name,
        status: 'pending',
        input: event.input,
        permissionLevel: event.permissionLevel,
        approvalDigest: event.approvalDigest,
        approvalReason: event.reason,
      };
      return {
        agentStatus: 'waiting_for_approval',
        toolActivity:
          existing === undefined
            ? [...state.toolActivity, next]
            : state.toolActivity.map((tool) => (tool.id === next.id ? next : tool)),
      };
    });
  } else if (event.type === 'change_set_ready') {
    set({ activeRequestId: undefined, agentStatus: 'waiting_for_approval' });
    void useChangeReviewStore.getState().notifyReady(event.changeSetId);
    void refreshConversationList(get, set);
  } else if (event.type === 'command_proposed') {
    set({ agentStatus: 'waiting_for_approval' });
    useCommandStore.getState().notify(event.command);
  } else if (event.type === 'command_status') {
    useCommandStore.getState().notify(event.command);
  } else if (event.type === 'command_output') {
    useCommandStore.getState().appendOutput(event.commandId, event.chunk);
  } else if (event.type === 'completed') {
    set({ activeRequestId: undefined, agentStatus: 'completed' });
    void refreshConversationList(get, set);
  } else if (event.type === 'cancelled') {
    set((state) => ({
      activeRequestId: undefined,
      agentStatus: 'cancelled',
      messages: updateLatestStreaming(state.messages, 'cancelled'),
    }));
  } else if (event.type === 'error') {
    set((state) => ({
      activeRequestId: undefined,
      agentStatus: 'failed',
      errorMessage: rendererErrorDetail(
        event.error.message,
        event.error.code,
        'chatOperationFailed',
      ),
      messages: updateLatestStreaming(state.messages, 'error'),
    }));
  }
}

async function refreshConversationList(get: () => ChatState, set: ChatStoreSet): Promise<void> {
  const workspaceId = get().workspaceId;
  if (workspaceId === undefined) {
    return;
  }
  try {
    const conversations = await window.openCodeDesk.conversations.list({
      workspaceId,
      query: '',
    });
    set({ conversations });
  } catch {
    // Completion is already visible; a later initialization can refresh the list.
  }
}
