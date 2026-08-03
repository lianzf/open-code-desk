import {
  Bot,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useChangeReviewStore } from '@/features/changes/change-review.store';
import { useCommandStore } from '@/features/commands/command.store';
import { ContextTray } from '@/features/context/context-tray';
import { useConversationContextStore } from '@/features/context/context.store';
import { useProviderStore } from '@/features/providers/provider.store';
import { translate } from '@/features/settings/i18n';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';
import { ChatMessageList } from './chat-message-list';
import { useChatStore } from './chat.store';

const statusLabels = {
  idle: 'statusIdle',
  analyzing: 'statusAnalyzing',
  planning: 'statusPlanning',
  waiting_for_approval: 'statusWaitingApproval',
  executing_tool: 'statusExecutingTool',
  editing_files: 'statusEditingFiles',
  running_tests: 'statusRunningTests',
  completed: 'statusCompleted',
  failed: 'statusFailed',
  cancelled: 'statusCancelled',
} as const;

export function ChatPanel() {
  const [draft, setDraft] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const currentWorkspace = useWorkspaceStore((state) => state.current);
  const chat = useChatStore();
  const bindStream = chat.bindStream;
  const initialize = chat.initialize;
  const provider = useProviderStore();
  const initializeChanges = useChangeReviewStore((state) => state.initialize);
  const initializeCommands = useCommandStore((state) => state.initialize);
  const initializeContext = useConversationContextStore((state) => state.initialize);
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(locale, key, values);

  useEffect(() => bindStream(), [bindStream]);

  useEffect(() => {
    if (currentWorkspace !== null) {
      void initialize(currentWorkspace.id);
    }
  }, [currentWorkspace, initialize]);

  useEffect(() => {
    if (chat.activeConversationId !== undefined && currentWorkspace !== null) {
      void initializeChanges(chat.activeConversationId);
      void initializeCommands(chat.activeConversationId, currentWorkspace.id);
      void initializeContext(chat.activeConversationId);
    }
  }, [
    chat.activeConversationId,
    currentWorkspace,
    initializeChanges,
    initializeCommands,
    initializeContext,
  ]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.messages, chat.toolActivity]);

  const selectedConfiguration = provider.configurations.find(
    (configuration) => configuration.id === provider.selectedProviderId,
  );
  const modelOptions =
    selectedConfiguration === undefined
      ? []
      : [
          selectedConfiguration.defaultModel,
          selectedConfiguration.fastModel,
          selectedConfiguration.reasoningModel,
          ...(provider.models[selectedConfiguration.id]?.map((model) => model.id) ?? []),
        ].filter(
          (value, index, values): value is string =>
            value !== undefined && values.indexOf(value) === index,
        );
  const activeConversation = chat.conversations.find(
    (conversation) => conversation.id === chat.activeConversationId,
  );

  const submit = () => {
    const text = draft;
    setDraft('');
    void chat.send(text);
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-zinc-800 bg-zinc-950">
      <header className="space-y-2 border-b border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-cyan-400" aria-hidden="true" />
          <span className="text-sm font-medium">{t('chatTitle')}</span>
          <span
            className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400"
            data-testid="agent-status"
          >
            {t(statusLabels[chat.agentStatus])}
          </span>
          <button
            className="ml-auto rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={provider.openSettings}
            aria-label={t('modelSettings')}
          >
            <Settings2 className="size-4" />
          </button>
        </div>

        <form
          className="flex items-center rounded border border-zinc-800 bg-zinc-900 px-2"
          onSubmit={(event) => {
            event.preventDefault();
            void chat.searchConversations(historyQuery);
          }}
        >
          <Search className="size-3.5 text-zinc-600" aria-hidden="true" />
          <input
            className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-xs text-zinc-300 outline-none placeholder:text-zinc-600"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            placeholder={t('searchConversations')}
            aria-label={t('searchConversations')}
            data-testid="conversation-search"
          />
          {chat.conversationQuery !== '' ? (
            <button
              type="button"
              className="text-[10px] text-zinc-500 hover:text-zinc-200"
              onClick={() => {
                setHistoryQuery('');
                void chat.searchConversations('');
              }}
            >
              {t('clear')}
            </button>
          ) : null}
        </form>

        <div className="flex items-center gap-1">
          <select
            className="h-8 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none"
            value={chat.activeConversationId ?? ''}
            onChange={(event) => void chat.selectConversation(event.target.value)}
            disabled={
              chat.activeRequestId !== undefined || chat.agentStatus === 'waiting_for_approval'
            }
            aria-label={t('selectConversation')}
            data-testid="conversation-select"
          >
            {chat.conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => void chat.newConversation()}
            disabled={chat.activeRequestId !== undefined}
            aria-label={t('newConversation')}
            data-testid="new-conversation"
          >
            <Plus className="size-4" />
          </button>
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => {
              if (activeConversation === undefined) {
                return;
              }
              const title = window.prompt(t('renameConversationPrompt'), activeConversation.title);
              if (title !== null && title.trim() !== '') {
                void chat.renameActive(title);
              }
            }}
            disabled={activeConversation === undefined || chat.activeRequestId !== undefined}
            aria-label={t('renameConversation')}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => void chat.exportActive()}
            disabled={activeConversation === undefined}
            aria-label={t('exportMarkdown')}
          >
            <Download className="size-3.5" />
          </button>
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
            onClick={() => {
              if (window.confirm(t('deleteConversationConfirm'))) {
                void chat.deleteActive();
              }
            }}
            disabled={activeConversation === undefined || chat.activeRequestId !== undefined}
            aria-label={t('deleteConversation')}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        {provider.configurations.length === 0 ? (
          <Button variant="outline" size="sm" className="w-full" onClick={provider.openSettings}>
            {t('configureProvider')}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <select
              className="h-8 min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none"
              value={provider.selectedProviderId ?? ''}
              onChange={(event) => provider.selectProvider(event.target.value)}
              aria-label={t('selectProvider')}
            >
              {provider.configurations.map((configuration) => (
                <option key={configuration.id} value={configuration.id}>
                  {configuration.displayName}
                </option>
              ))}
            </select>
            <select
              className="h-8 min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none"
              value={
                selectedConfiguration === undefined
                  ? ''
                  : (provider.selectedModels[selectedConfiguration.id] ??
                    selectedConfiguration.defaultModel)
              }
              onChange={(event) => {
                if (selectedConfiguration !== undefined) {
                  provider.selectModel(selectedConfiguration.id, event.target.value);
                }
              }}
              aria-label={t('selectModel')}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <ChatMessageList endRef={endRef} />

      <footer className="min-h-0 max-h-[70%] shrink overflow-y-auto border-t border-zinc-800 p-3">
        {chat.contextStats !== undefined ? (
          <p className="mb-2 text-[10px] text-zinc-600" data-testid="context-stats">
            {t('context')} {chat.contextStats.usedTokens}/{chat.contextStats.budget} tokens
            {chat.contextStats.summarizedMessages > 0
              ? ` · ${t('summarizedMessages', { value: chat.contextStats.summarizedMessages })}`
              : ''}
            {chat.contextStats.selectedContextItems > 0
              ? ` · ${t('selectedAttachments', { value: chat.contextStats.selectedContextItems })}`
              : ''}
            {chat.contextStats.droppedContextItems > 0
              ? ` · ${t('droppedAttachments', { value: chat.contextStats.droppedContextItems })}`
              : ''}
          </p>
        ) : null}
        {chat.errorMessage !== undefined ? (
          <p className="mb-2 rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">
            {chat.errorMessage}
          </p>
        ) : null}
        <ContextTray />
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 focus-within:border-cyan-700">
          <textarea
            className="max-h-40 min-h-20 w-full resize-none bg-transparent p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t('chatPlaceholder')}
            disabled={chat.activeRequestId !== undefined}
            data-testid="chat-input"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void chat.regenerate()}
              disabled={chat.activeRequestId !== undefined || chat.messages.length === 0}
            >
              <RotateCcw className="size-3.5" />
              {t('retry')}
            </Button>
            {chat.activeRequestId === undefined ? (
              <Button
                size="sm"
                onClick={submit}
                disabled={
                  draft.trim() === '' ||
                  selectedConfiguration === undefined ||
                  chat.activeConversationId === undefined ||
                  chat.agentStatus === 'waiting_for_approval'
                }
                data-testid="send-chat"
              >
                <Send className="size-3.5" />
                {t('send')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void chat.stop()}
                data-testid="stop-chat"
              >
                <Square className="size-3.5" />
                {t('stop')}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </aside>
  );
}
