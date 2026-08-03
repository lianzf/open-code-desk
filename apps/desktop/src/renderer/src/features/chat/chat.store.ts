import { create } from 'zustand';

import { rendererError, rendererErrorDetail } from '../settings/error-i18n';
import {
  type ChatState,
  type DisplayChatMessage,
  readableChatError,
  selectedProviderInput,
  toToolActivity,
} from './chat-store-support';
import { handleStreamEvent, toDisplayMessage } from './chat-stream';

export type {
  ChatMessageStatus,
  ChatState,
  ContextStats,
  DisplayChatMessage,
  DisplayToolActivity,
} from './chat-store-support';

export const useChatStore = create<ChatState>((set, get) => ({
  workspaceId: undefined,
  activeRequestId: undefined,
  activeConversationId: undefined,
  agentStatus: 'idle',
  conversations: [],
  conversationQuery: '',
  contextStats: undefined,
  taskPlan: undefined,
  taskAttempt: undefined,
  errorMessage: undefined,
  messages: [],
  toolActivity: [],

  bindStream() {
    return window.openCodeDesk.chat.onStreamEvent((event) => {
      if (event.requestId === get().activeRequestId) {
        handleStreamEvent(event, set, get);
      }
    });
  },

  async initialize(workspaceId) {
    if (get().workspaceId === workspaceId) {
      return;
    }
    set({
      workspaceId,
      activeConversationId: undefined,
      activeRequestId: undefined,
      agentStatus: 'idle',
      conversations: [],
      conversationQuery: '',
      messages: [],
      toolActivity: [],
      contextStats: undefined,
      taskPlan: undefined,
      taskAttempt: undefined,
      errorMessage: undefined,
    });
    try {
      let conversations = await window.openCodeDesk.conversations.list({
        workspaceId,
        query: '',
      });
      if (conversations.length === 0) {
        const provider = selectedProviderInput();
        const created = await window.openCodeDesk.conversations.create({
          workspaceId,
          ...(provider === null
            ? {}
            : { providerConfigId: provider.providerId, modelId: provider.model }),
        });
        conversations = [created];
      }
      set({ conversations });
      const first = conversations[0];
      if (first !== undefined) {
        await get().selectConversation(first.id);
      }
    } catch (error) {
      set({ errorMessage: readableChatError(error) });
    }
  },

  async newConversation() {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined || get().activeRequestId !== undefined) {
      return;
    }
    try {
      const provider = selectedProviderInput();
      const conversation = await window.openCodeDesk.conversations.create({
        workspaceId,
        ...(provider === null
          ? {}
          : { providerConfigId: provider.providerId, modelId: provider.model }),
      });
      set((state) => ({ conversations: [conversation, ...state.conversations] }));
      set({ conversationQuery: '' });
      await get().selectConversation(conversation.id);
    } catch (error) {
      set({ errorMessage: readableChatError(error) });
    }
  },

  async selectConversation(conversationId) {
    if (get().activeRequestId !== undefined) {
      return;
    }
    try {
      const detail = await window.openCodeDesk.conversations.get({ conversationId });
      set({
        activeConversationId: detail.conversation.id,
        messages: detail.messages
          .map(toDisplayMessage)
          .filter((message): message is DisplayChatMessage => message !== null),
        toolActivity: detail.toolCalls.map(toToolActivity),
        agentStatus: detail.latestTask?.status ?? 'idle',
        contextStats: undefined,
        taskPlan: detail.latestTask?.checkpoint,
        taskAttempt: detail.latestTask?.attempt,
        errorMessage:
          detail.latestTask?.error === undefined
            ? undefined
            : rendererErrorDetail(
                detail.latestTask.error.message,
                detail.latestTask.error.code,
                'chatOperationFailed',
              ),
      });
    } catch (error) {
      set({ errorMessage: readableChatError(error) });
    }
  },

  async renameActive(title) {
    const conversationId = get().activeConversationId;
    if (conversationId === undefined) {
      return;
    }
    try {
      const updated = await window.openCodeDesk.conversations.rename({
        conversationId,
        title,
      });
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === updated.id ? updated : conversation,
        ),
      }));
    } catch (error) {
      set({ errorMessage: readableChatError(error) });
    }
  },

  async deleteActive() {
    const conversationId = get().activeConversationId;
    const workspaceId = get().workspaceId;
    if (
      conversationId === undefined ||
      workspaceId === undefined ||
      get().activeRequestId !== undefined
    ) {
      return;
    }
    try {
      await window.openCodeDesk.conversations.delete({ conversationId });
      const conversations = await window.openCodeDesk.conversations.list({
        workspaceId,
        query: '',
      });
      set({
        conversations,
        conversationQuery: '',
        activeConversationId: undefined,
        messages: [],
        toolActivity: [],
      });
      const next = conversations[0];
      if (next === undefined) {
        await get().newConversation();
      } else {
        await get().selectConversation(next.id);
      }
    } catch (error) {
      set({ errorMessage: readableChatError(error) });
    }
  },

  async exportActive() {
    const conversationId = get().activeConversationId;
    if (conversationId === undefined) {
      return;
    }
    try {
      await window.openCodeDesk.conversations.exportMarkdown({ conversationId });
    } catch (error) {
      set({ errorMessage: readableChatError(error) });
    }
  },

  async send(content) {
    const text = content.trim();
    const workspaceId = get().workspaceId;
    const conversationId = get().activeConversationId;
    if (
      text === '' ||
      workspaceId === undefined ||
      conversationId === undefined ||
      get().activeRequestId !== undefined ||
      get().agentStatus === 'waiting_for_approval'
    ) {
      return;
    }
    const provider = selectedProviderInput(true);
    if (provider === null) {
      set({ errorMessage: rendererError('selectProvider') });
      return;
    }
    const requestId = crypto.randomUUID();
    const localUserMessage: DisplayChatMessage = {
      id: `local-${crypto.randomUUID()}`,
      role: 'user',
      content: text,
      reasoning: '',
      status: 'complete',
    };
    set((state) => ({
      activeRequestId: requestId,
      agentStatus: 'analyzing',
      messages: [...state.messages, localUserMessage],
      errorMessage: undefined,
      contextStats: undefined,
      taskPlan: undefined,
      taskAttempt: undefined,
    }));
    try {
      const response = await window.openCodeDesk.chat.start({
        requestId,
        workspaceId,
        conversationId,
        providerId: provider.providerId,
        model: provider.model,
        content: text,
      });
      if (response.requestId !== requestId) {
        throw new Error(rendererError('requestIdMismatch'));
      }
    } catch (error) {
      set({
        activeRequestId: undefined,
        agentStatus: 'failed',
        errorMessage: readableChatError(error),
      });
    }
  },

  async stop() {
    const requestId = get().activeRequestId;
    if (requestId !== undefined) {
      await window.openCodeDesk.chat.cancel({ requestId });
    }
  },

  async regenerate() {
    if (get().activeRequestId !== undefined) {
      return;
    }
    const lastUser = [...get().messages].reverse().find((message) => message.role === 'user');
    if (lastUser !== undefined) {
      await get().send(lastUser.content);
    }
  },

  async searchConversations(query) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    try {
      const results = await window.openCodeDesk.conversations.list({ workspaceId, query });
      const active = get().conversations.find(
        (conversation) => conversation.id === get().activeConversationId,
      );
      const conversations =
        active !== undefined && !results.some((conversation) => conversation.id === active.id)
          ? [active, ...results]
          : results;
      set({ conversations, conversationQuery: query, errorMessage: undefined });
    } catch (error) {
      set({ errorMessage: readableChatError(error) });
    }
  },
}));
