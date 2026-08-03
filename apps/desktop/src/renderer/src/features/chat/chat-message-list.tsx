import { Bot, Copy, User } from 'lucide-react';
import type { RefObject } from 'react';

import { ChangeReviewSummary } from '@/features/changes/change-review-panel';
import { CommandReviewPanel } from '@/features/commands/command-review-panel';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import { useChatStore } from './chat.store';
import { MarkdownMessage } from './markdown-message';
import { ToolActivityItem } from './tool-activity-item';

interface ChatMessageListProps {
  readonly endRef: RefObject<HTMLDivElement | null>;
}

export function ChatMessageList({ endRef }: ChatMessageListProps) {
  const chat = useChatStore();
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
    translate(locale, key, values);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3" data-testid="chat-messages">
      {chat.messages.length === 0 ? (
        <div className="grid h-full place-items-center text-center">
          <div>
            <Bot className="mx-auto size-7 text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-500">{t('chatEmptyTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-700">
              {t('chatEmptyDescription')}
              <br />
              {t('chatApprovalDescription')}
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
              {message.role === 'user' ? t('you') : t('assistant')}
              <button
                className="ml-auto rounded p-1 hover:bg-zinc-800 hover:text-zinc-300"
                onClick={() => void navigator.clipboard.writeText(message.content)}
                aria-label={t('copyMessage')}
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
                  <summary className="cursor-pointer">{t('reasoning')}</summary>
                  <p className="mt-2 whitespace-pre-wrap">{message.reasoning}</p>
                </details>
              ) : null}
              <MarkdownMessage
                content={
                  message.content === '' && message.status === 'streaming'
                    ? t('generating')
                    : message.content
                }
              />
              {message.usage !== undefined ? (
                <p className="mt-2 text-[10px] text-zinc-700">
                  {t('inputTokens')} {message.usage.inputTokens} · {t('outputTokens')}{' '}
                  {message.usage.outputTokens} tokens
                </p>
              ) : null}
              {message.status === 'cancelled' ? (
                <p className="mt-2 text-[11px] text-amber-400">{t('generationStopped')}</p>
              ) : null}
              {message.status === 'error' ? (
                <p className="mt-2 text-[11px] text-red-400">{t('turnFailed')}</p>
              ) : null}
            </div>
          </article>
        ))
      )}

      {chat.taskPlan === undefined || chat.taskPlan.steps.length === 0 ? null : (
        <details
          className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2"
          open={chat.agentStatus !== 'completed'}
          data-testid="task-plan"
        >
          <summary className="cursor-pointer text-[11px] text-zinc-400">
            {t('taskPlan')} · {t('attempt', { value: chat.taskAttempt ?? 1 })} ·{' '}
            {t('round', { value: chat.taskPlan.round })}
          </summary>
          <ol className="mt-2 space-y-1">
            {chat.taskPlan.steps.map((step) => (
              <li key={step.id} className="flex items-center gap-2 text-[10px]">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    step.status === 'completed'
                      ? 'bg-emerald-500'
                      : step.status === 'in_progress'
                        ? 'animate-pulse bg-cyan-400'
                        : step.status === 'failed'
                          ? 'bg-red-500'
                          : step.status === 'cancelled'
                            ? 'bg-amber-500'
                            : 'bg-zinc-700'
                  }`}
                />
                <span className={step.status === 'in_progress' ? 'text-zinc-300' : 'text-zinc-500'}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {chat.toolActivity.length > 0 ? (
        <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2" open>
          <summary className="cursor-pointer text-[11px] text-zinc-400">
            {t('toolHistory')}（{chat.toolActivity.length}）
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
  );
}
