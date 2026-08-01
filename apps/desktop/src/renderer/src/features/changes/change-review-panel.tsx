import { DiffEditor } from '@monaco-editor/react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  FileDiff,
  LoaderCircle,
  RotateCcw,
  Save,
  X,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/features/chat/chat.store';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';
import { useResolvedTheme } from '@/features/settings/use-resolved-theme';
import { cn } from '@/lib/utils';
import { useChangeReviewStore } from './change-review.store';
import '../editor/monaco-environment';

const setStatusLabels = {
  pending_review: '待审核',
  ready_to_apply: '可应用',
  applying: '应用中',
  applied: '已应用',
  failed: '失败',
  rolling_back: '回滚中',
  rolled_back: '已回滚',
  cancelled: '已拒绝',
} as const;

const operationLabels = {
  create: '新建',
  update: '修改',
  delete: '删除',
  rename: '重命名',
} as const;

function languageFor(path: string): string {
  const extension = path.split('.').pop()?.toLocaleLowerCase('en-US');
  const languages: Readonly<Record<string, string>> = {
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return extension === undefined ? 'plaintext' : (languages[extension] ?? 'plaintext');
}

function isDangerous(operation: 'create' | 'update' | 'delete' | 'rename'): boolean {
  return operation === 'delete' || operation === 'rename';
}

export function ChangeReviewSummary() {
  const review = useChangeReviewStore();
  const active =
    review.changeSets.find((changeSet) =>
      ['pending_review', 'ready_to_apply', 'failed'].includes(changeSet.status),
    ) ?? review.changeSets[0];
  if (active === undefined) {
    return null;
  }
  const pending = active.changes.filter((change) =>
    ['pending', 'approved', 'failed'].includes(change.status),
  ).length;
  return (
    <button
      className="flex w-full items-center justify-between rounded-lg border border-cyan-900/60 bg-cyan-950/20 px-3 py-2 text-left text-xs text-cyan-200 hover:border-cyan-700"
      onClick={() => void review.show(active.id)}
      data-testid="open-change-review"
    >
      <span className="flex items-center gap-2">
        <FileDiff className="size-4" />
        代码变更审核
      </span>
      <span>{pending > 0 ? `${pending} 个待处理文件` : setStatusLabels[active.status]}</span>
    </button>
  );
}

export function ChangeReviewDialog() {
  const resolvedTheme = useResolvedTheme();
  const review = useChangeReviewStore();
  const refreshTree = useWorkspaceStore((state) => state.refreshTree);
  const refreshConversation = useChatStore((state) => state.selectConversation);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const activeSet = review.changeSets.find((item) => item.id === review.activeSetId);
  const activeChange = activeSet?.changes.find((item) => item.id === review.activeChangeId);
  const editable =
    activeChange !== undefined &&
    (activeChange.operation === 'create' || activeChange.operation === 'update') &&
    activeSet !== undefined &&
    ['pending_review', 'ready_to_apply', 'failed'].includes(activeSet.status);
  const draftDirty =
    editable &&
    review.contents !== undefined &&
    review.proposedDraft !== review.contents.proposedContent;

  if (!review.open || activeSet === undefined) {
    return null;
  }

  const refreshAfterMutation = async () => {
    await refreshTree();
    if (activeConversationId !== undefined) {
      await refreshConversation(activeConversationId);
    }
  };

  const approveSelected = async () => {
    if (
      activeChange !== undefined &&
      isDangerous(activeChange.operation) &&
      !window.confirm(
        `确认批准高风险操作：${operationLabels[activeChange.operation]} ${activeChange.filePath}？`,
      )
    ) {
      return;
    }
    await review.reviewSelected('approve');
  };

  const rejectSelected = async () => {
    await review.reviewSelected('reject');
    const updated = useChangeReviewStore
      .getState()
      .changeSets.find((item) => item.id === activeSet.id);
    if (updated?.status === 'cancelled' && activeConversationId !== undefined) {
      await refreshConversation(activeConversationId);
    }
  };

  const rejectAll = async () => {
    await review.reviewAll('reject');
    if (activeConversationId !== undefined) {
      await refreshConversation(activeConversationId);
    }
  };

  const approveAll = async () => {
    const dangerous = activeSet.changes.filter((change) => isDangerous(change.operation));
    if (
      dangerous.length > 0 &&
      !window.confirm(`本次包含 ${dangerous.length} 个删除或重命名操作，确认全部批准？`)
    ) {
      return;
    }
    await review.reviewAll('approve');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="代码变更审核"
      data-testid="change-review-dialog"
    >
      <section className="m-auto flex h-[min(900px,94vh)] w-[min(1500px,96vw)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
          <FileDiff className="size-4 text-cyan-400" />
          <div>
            <p className="text-sm font-medium">代码变更审核</p>
            <p className="text-[10px] text-zinc-500">只有已批准且摘要未变化的文件才会写入工作区</p>
          </div>
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">
            {setStatusLabels[activeSet.status]}
          </span>
          <select
            className="ml-auto h-7 max-w-64 rounded border border-zinc-800 bg-zinc-900 px-2 text-xs"
            value={activeSet.id}
            onChange={(event) => void review.selectSet(event.target.value)}
            aria-label="变更历史"
          >
            {review.changeSets.map((changeSet) => (
              <option key={changeSet.id} value={changeSet.id}>
                {new Date(changeSet.updatedAt).toLocaleString()} ·{' '}
                {setStatusLabels[changeSet.status]}
              </option>
            ))}
          </select>
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={review.close}
            aria-label="关闭变更审核"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 overflow-auto border-r border-zinc-800 p-2">
            {activeSet.changes.map((change) => (
              <button
                key={change.id}
                className={cn(
                  'mb-1 w-full rounded-lg border px-2.5 py-2 text-left',
                  change.id === activeChange?.id
                    ? 'border-cyan-800 bg-cyan-950/30'
                    : 'border-transparent hover:bg-zinc-900',
                )}
                onClick={() => void review.selectChange(change.id)}
                data-testid={`change-file-${change.sequence}`}
              >
                <span className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{change.filePath}</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[9px]',
                      change.status === 'approved'
                        ? 'bg-emerald-950 text-emerald-300'
                        : change.status === 'rejected'
                          ? 'bg-red-950 text-red-300'
                          : 'bg-zinc-800 text-zinc-400',
                    )}
                  >
                    {change.status}
                  </span>
                </span>
                <span className="mt-1 block text-[10px] text-zinc-500">
                  {operationLabels[change.operation]}
                  {change.destinationPath === undefined ? '' : ` → ${change.destinationPath}`}
                </span>
              </button>
            ))}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {review.loading || activeChange === undefined || review.contents === undefined ? (
              <div className="grid flex-1 place-items-center text-xs text-zinc-500">
                <LoaderCircle className="mb-2 size-5 animate-spin" />
                正在加载变更内容…
              </div>
            ) : (
              <DiffEditor
                key={`${activeChange.id}:${activeChange.reviewDigest}`}
                original={review.contents.originalContent}
                modified={review.proposedDraft}
                language={languageFor(activeChange.destinationPath ?? activeChange.filePath)}
                theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
                originalModelPath={`opencode-review://original/${activeChange.id}`}
                modifiedModelPath={`opencode-review://proposed/${activeChange.id}/${activeChange.reviewDigest}`}
                onMount={(editor) => {
                  editor.getModifiedEditor().onDidChangeModelContent(() => {
                    review.updateDraft(editor.getModifiedEditor().getValue());
                  });
                }}
                options={{
                  automaticLayout: true,
                  fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
                  fontSize: 13,
                  originalEditable: false,
                  readOnly: !editable,
                  renderSideBySide: true,
                  scrollBeyondLastLine: false,
                }}
              />
            )}
          </div>
        </div>

        {review.errorMessage !== undefined || activeSet.error !== undefined ? (
          <div className="flex items-center gap-2 border-t border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">
            <AlertTriangle className="size-4 shrink-0" />
            {review.errorMessage ?? activeSet.error}
          </div>
        ) : null}

        <footer className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-t border-zinc-800 px-4 py-2">
          {draftDirty ? (
            <Button
              size="sm"
              variant="outline"
              disabled={review.busy}
              onClick={() => void review.saveEdit()}
              data-testid="save-proposed-change"
            >
              <Save className="size-3.5" />
              保存提案编辑
            </Button>
          ) : null}
          {['pending_review', 'ready_to_apply', 'failed'].includes(activeSet.status) ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={review.busy || activeChange === undefined || draftDirty}
                onClick={() => void rejectSelected()}
                data-testid="reject-change"
              >
                <XCircle className="size-3.5" />
                拒绝此文件
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={review.busy || activeChange === undefined || draftDirty}
                onClick={() => void approveSelected()}
                data-testid="approve-change"
              >
                <Check className="size-3.5" />
                批准此文件
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={review.busy}
                onClick={() => void rejectAll()}
              >
                全部拒绝
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={review.busy || draftDirty}
                onClick={() => void approveAll()}
                data-testid="approve-all-changes"
              >
                <CheckCheck className="size-3.5" />
                全部批准
              </Button>
            </>
          ) : null}
          <span className="ml-auto text-[10px] text-zinc-600">
            {activeSet.changes.filter((change) => change.status === 'approved').length} 个已批准
          </span>
          {activeSet.status === 'ready_to_apply' ? (
            <Button
              size="sm"
              disabled={review.busy || draftDirty}
              onClick={() => {
                if (window.confirm('仅应用当前已批准的固定变更集？')) {
                  void review.applyActive().then(refreshAfterMutation);
                }
              }}
              data-testid="apply-approved-changes"
            >
              {review.busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCheck />}
              应用已批准变更
            </Button>
          ) : null}
          {activeSet.status === 'applied' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={review.busy}
              onClick={() => {
                if (window.confirm('回滚这个变更集？若文件已被再次修改，回滚会被阻止。')) {
                  void review.rollbackActive().then(refreshAfterMutation);
                }
              }}
              data-testid="rollback-change-set"
            >
              <RotateCcw className="size-3.5" />
              回滚
            </Button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
