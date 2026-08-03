import { FileCode2, GitBranch, Paperclip, RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';

import { useConversationContextStore } from '@/features/context/context.store';
import { type GitTranslationKey, useGitTranslation } from './git-i18n';
import { useGitStore } from './git.store';

interface GitPanelProps {
  readonly workspaceId: string;
  readonly onClose: () => void;
}

function statusLabelKey(file: {
  readonly staged: boolean;
  readonly modified: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
}): GitTranslationKey {
  if (file.conflicted) {
    return 'conflicted';
  }
  if (file.untracked) {
    return 'untracked';
  }
  if (file.staged && file.modified) {
    return 'stagedModified';
  }
  if (file.staged) {
    return 'staged';
  }
  return 'modified';
}

export function GitPanel({ workspaceId, onClose }: GitPanelProps) {
  const { t } = useGitTranslation();
  const git = useGitStore();
  const contextConversationId = useConversationContextStore((state) => state.conversationId);
  const saveContext = useConversationContextStore((state) => state.save);
  const initialize = git.initialize;

  useEffect(() => {
    void initialize(workspaceId);
  }, [initialize, workspaceId]);

  const status = git.status;

  return (
    <section
      className="flex h-full min-h-0 flex-col border-t border-zinc-800 bg-zinc-950"
      data-testid="git-panel"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-[11px]">
        <GitBranch className="size-3.5 text-cyan-500" />
        <span className="font-medium text-zinc-300">Git</span>
        {status?.isRepository === true ? (
          <>
            <span className="text-zinc-500">{status.branch ?? 'detached HEAD'}</span>
            {status.tracking === undefined ? null : (
              <span className="text-zinc-600">
                ↕ {status.tracking} · ↑{status.ahead} ↓{status.behind}
              </span>
            )}
            <span className="text-zinc-600">
              {status.clean
                ? t('cleanWorkspace')
                : t('changeCount', { count: status.files.length })}
            </span>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-cyan-300 disabled:opacity-40"
            onClick={() => {
              const diff = git.diff;
              if (diff !== undefined && diff.content !== '') {
                const scope = diff.path ?? t('allChanges');
                void saveContext({
                  type: 'git_diff',
                  title: t('diffContextTitle', {
                    scope: diff.staged ? t('stagedArea') : t('workspace'),
                    path: scope,
                  }),
                  content: diff.content,
                  priority: 80,
                  sourceKey: `git-diff:${diff.staged ? 'staged' : 'worktree'}:${diff.path ?? '*'}`,
                });
              }
            }}
            disabled={
              contextConversationId === undefined ||
              git.diff === undefined ||
              git.diff.content === ''
            }
            aria-label={t('addDiffContext')}
            title={t('addDiffContextTitle')}
            data-testid="add-git-diff-context"
          >
            <Paperclip className="size-3.5" />
          </button>
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => void git.refresh()}
            disabled={git.loading}
            aria-label={t('refreshStatus')}
            data-testid="refresh-git"
          >
            <RefreshCw className={`size-3.5 ${git.loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
            aria-label={t('closePanel')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      {git.errorMessage === undefined ? null : (
        <p className="shrink-0 border-b border-red-950 bg-red-950/40 px-3 py-1 text-[11px] text-red-300">
          {git.errorMessage}
        </p>
      )}

      {status === undefined ? (
        <div className="grid flex-1 place-items-center text-xs text-zinc-600">
          {t('readingGit')}
        </div>
      ) : !status.isRepository ? (
        <div className="grid flex-1 place-items-center text-xs text-zinc-600">
          {t('notRepository')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 overflow-auto border-r border-zinc-800 p-1">
            <button
              className={`w-full rounded px-2 py-1.5 text-left text-[11px] ${
                git.selectedPath === undefined
                  ? 'bg-zinc-800 text-zinc-200'
                  : 'text-zinc-500 hover:bg-zinc-900'
              }`}
              onClick={() => void git.selectPath(undefined)}
            >
              {t('allChanges')}
            </button>
            {status.files.map((file) => (
              <button
                key={`${file.path}-${file.indexStatus}-${file.workingTreeStatus}`}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
                  git.selectedPath === file.path
                    ? 'bg-zinc-800 text-zinc-200'
                    : 'text-zinc-500 hover:bg-zinc-900'
                }`}
                onClick={() => void git.selectPath(file.path)}
              >
                <FileCode2 className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                <span
                  className={
                    file.conflicted
                      ? 'text-red-400'
                      : file.staged
                        ? 'text-cyan-400'
                        : 'text-amber-400'
                  }
                >
                  {t(statusLabelKey(file))}
                </span>
              </button>
            ))}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-zinc-800 px-2">
              <button
                className={`rounded px-2 py-1 text-[10px] ${
                  !git.staged ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500'
                }`}
                onClick={() => void git.setStaged(false)}
              >
                {t('workspaceDiff')}
              </button>
              <button
                className={`rounded px-2 py-1 text-[10px] ${
                  git.staged ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500'
                }`}
                onClick={() => void git.setStaged(true)}
              >
                {t('stagedDiff')}
              </button>
              {git.diff?.truncated === true ? (
                <span className="ml-auto text-[10px] text-amber-400">{t('diffTruncated')}</span>
              ) : null}
            </div>
            <pre
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-4 text-zinc-400"
              data-testid="git-diff"
            >
              {git.diff?.content === '' ? t('emptyDiff') : (git.diff?.content ?? '')}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
