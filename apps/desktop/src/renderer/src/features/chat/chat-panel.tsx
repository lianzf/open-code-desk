import {
  Bot,
  Copy,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Square,
  Trash2,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ChangeReviewSummary } from '@/features/changes/change-review-panel';
import { useChangeReviewStore } from '@/features/changes/change-review.store';
import { CommandReviewPanel } from '@/features/commands/command-review-panel';
import { useCommandStore } from '@/features/commands/command.store';
import { ContextTray } from '@/features/context/context-tray';
import { useConversationContextStore } from '@/features/context/context.store';
import { useProviderStore } from '@/features/providers/provider.store';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';
import { useChatStore } from './chat.store';
import { MarkdownMessage } from './markdown-message';
import { ToolActivityItem } from './tool-activity-item';

const statusLabels = {
  idle: '空闲',
  analyzing: '分析中',
  planning: '规划中',
  waiting_for_approval: '等待批准',
  executing_tool: '执行工具',
  editing_files: '准备修改',
  running_tests: '运行测试',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
} as const;

export function ChatPanel() {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const currentWorkspace = useWorkspaceStore((state) => state.current);
  const chat = useChatStore();
  const bindStream = chat.bindStream;
  const initialize = chat.initialize;
  const provider = useProviderStore();
  const initializeChanges = useChangeReviewStore((state) => state.initialize);
  const initializeCommands = useCommandStore((state) => state.initialize);
  const initializeContext = useConversationContextStore((state) => state.initialize);

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
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <header className="space-y-2 border-b border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-cyan-400" aria-hidden="true" />
          <span className="text-sm font-medium">AI 编程助手</span>
          <span
            className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400"
            data-testid="agent-status"
          >
            {statusLabels[chat.agentStatus]}
          </span>
          <button
            className="ml-auto rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={provider.openSettings}
            aria-label="模型设置"
          >
            <Settings2 className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <select
            className="h-8 min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none"
            value={chat.activeConversationId ?? ''}
            onChange={(event) => void chat.selectConversation(event.target.value)}
            disabled={
              chat.activeRequestId !== undefined || chat.agentStatus === 'waiting_for_approval'
            }
            aria-label="选择会话"
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
            aria-label="新建会话"
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
              const title = window.prompt('输入新的会话名称', activeConversation.title);
              if (title !== null && title.trim() !== '') {
                void chat.renameActive(title);
              }
            }}
            disabled={activeConversation === undefined || chat.activeRequestId !== undefined}
            aria-label="重命名会话"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => void chat.exportActive()}
            disabled={activeConversation === undefined}
            aria-label="导出 Markdown"
          >
            <Download className="size-3.5" />
          </button>
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
            onClick={() => {
              if (window.confirm('删除当前会话？该操作会从历史列表中移除会话。')) {
                void chat.deleteActive();
              }
            }}
            disabled={activeConversation === undefined || chat.activeRequestId !== undefined}
            aria-label="删除会话"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        {provider.configurations.length === 0 ? (
          <Button variant="outline" size="sm" className="w-full" onClick={provider.openSettings}>
            配置模型服务
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <select
              className="h-8 min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none"
              value={provider.selectedProviderId ?? ''}
              onChange={(event) => provider.selectProvider(event.target.value)}
              aria-label="选择模型服务"
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
              aria-label="选择模型"
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

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3" data-testid="chat-messages">
        {chat.messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Bot className="mx-auto size-7 text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500">描述你的编程任务</p>
              <p className="mt-1 text-xs leading-5 text-zinc-700">
                Agent 会按需读取项目文件并显示工具轨迹。
                <br />
                写文件和命令执行仍需单独批准。
              </p>
            </div>
          </div>
        ) : (
          chat.messages.map((message) => (
            <article key={message.id} className={message.role === 'user' ? 'ml-6' : 'mr-2'}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-zinc-600">
                {message.role === 'user' ? (
                  <User className="size-3" />
                ) : (
                  <Bot className="size-3 text-cyan-600" />
                )}
                {message.role === 'user' ? '你' : '助手'}
                <button
                  className="ml-auto rounded p-1 hover:bg-zinc-800 hover:text-zinc-300"
                  onClick={() => void navigator.clipboard.writeText(message.content)}
                  aria-label="复制消息"
                >
                  <Copy className="size-3" />
                </button>
              </div>
              <div
                className={
                  message.role === 'user'
                    ? 'rounded-xl bg-zinc-800 px-3 py-2'
                    : 'rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2'
                }
              >
                {message.reasoning !== '' ? (
                  <details className="mb-2 text-xs text-zinc-500">
                    <summary className="cursor-pointer">推理过程</summary>
                    <p className="mt-2 whitespace-pre-wrap">{message.reasoning}</p>
                  </details>
                ) : null}
                <MarkdownMessage
                  content={
                    message.content === '' && message.status === 'streaming'
                      ? '正在生成…'
                      : message.content
                  }
                />
                {message.usage !== undefined ? (
                  <p className="mt-2 text-[10px] text-zinc-700">
                    输入 {message.usage.inputTokens} · 输出 {message.usage.outputTokens} tokens
                  </p>
                ) : null}
                {message.status === 'cancelled' ? (
                  <p className="mt-2 text-[11px] text-amber-400">已停止生成</p>
                ) : null}
                {message.status === 'error' ? (
                  <p className="mt-2 text-[11px] text-red-400">本轮执行失败</p>
                ) : null}
              </div>
            </article>
          ))
        )}

        {chat.toolActivity.length > 0 ? (
          <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2" open>
            <summary className="cursor-pointer text-[11px] text-zinc-400">
              工具执行记录（{chat.toolActivity.length}）
            </summary>
            <div className="mt-2 space-y-1.5">
              {chat.toolActivity.map((activity) => (
                <ToolActivityItem key={activity.id} activity={activity} />
              ))}
            </div>
          </details>
        ) : null}
        <ChangeReviewSummary />
        <CommandReviewPanel />
        <div ref={endRef} />
      </div>

      <footer className="border-t border-zinc-800 p-3">
        {chat.contextStats !== undefined ? (
          <p className="mb-2 text-[10px] text-zinc-600" data-testid="context-stats">
            上下文 {chat.contextStats.usedTokens}/{chat.contextStats.budget} tokens
            {chat.contextStats.summarizedMessages > 0
              ? ` · 已摘要 ${chat.contextStats.summarizedMessages} 条历史消息`
              : ''}
            {chat.contextStats.selectedContextItems > 0
              ? ` · 已使用 ${chat.contextStats.selectedContextItems} 项附件`
              : ''}
            {chat.contextStats.droppedContextItems > 0
              ? ` · 裁减 ${chat.contextStats.droppedContextItems} 项`
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
            placeholder="输入任务，Ctrl/Cmd + Enter 发送"
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
              重试
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
                发送
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void chat.stop()}
                data-testid="stop-chat"
              >
                <Square className="size-3.5" />
                停止
              </Button>
            )}
          </div>
        </div>
      </footer>
    </aside>
  );
}
