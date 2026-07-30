import type { Conversation, ToolCallRecord } from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

import { useProviderStore } from '@/features/providers/provider.store';
import { handleStreamEvent, toDisplayMessage } from './chat-stream';

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

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  }
  return '操作失败，请检查模型配置和网络连接。';
}

function toToolActivity(toolCall: ToolCallRecord): DisplayToolActivity {
  let outputPreview: string | undefined;
  if (toolCall.output !== undefined) {
    try {
      outputPreview = JSON.stringify(toolCall.output).slice(0, 2_000);
    } catch {
      outputPreview = '工具结果无法显示。';
    }
  }
  return {
    id: toolCall.id,
    name: toolCall.toolName,
    status: toolCall.status,
    input: toolCall.input,
    ...(outputPreview === undefined ? {} : { outputPreview }),
    ...(toolCall.error === undefined ? {} : { errorMessage: toolCall.error.message }),
  };
}

function selectedProviderInput(openSettings = false): {
  readonly providerId: string;
  readonly model: string;
} | null {
  const state = useProviderStore.getState();
  const providerId = state.selectedProviderId;
  const configuration = state.configurations.find((item) => item.id === providerId);
  if (providerId === undefined || configuration === undefined) {
    if (openSettings) {
      state.openSettings();
    }
    return null;
  }
  return {
    providerId,
    model: state.selectedModels[providerId] ?? configuration.defaultModel,
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  workspaceId: undefined,
  activeRequestId: undefined,
  activeConversationId: undefined,
  agentStatus: 'idle',
  conversations: [],
  conversationQuery: '',
  contextStats: undefined,
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
      set({ errorMessage: readableError(error) });
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
      set({ errorMessage: readableError(error) });
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
        errorMessage: detail.latestTask?.error?.message,
      });
    } catch (error) {
      set({ errorMessage: readableError(error) });
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
      set({ errorMessage: readableError(error) });
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
      set({ errorMessage: readableError(error) });
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
      set({ errorMessage: readableError(error) });
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
      set({ errorMessage: '请先配置并选择一个模型服务。' });
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
        throw new Error('主进程返回了不匹配的请求标识。');
      }
    } catch (error) {
      set({
        activeRequestId: undefined,
        agentStatus: 'failed',
        errorMessage: readableError(error),
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
      set({ errorMessage: readableError(error) });
    }
  },
}));
