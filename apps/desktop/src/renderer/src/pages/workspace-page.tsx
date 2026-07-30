import {
  ChevronRight,
  GitBranch,
  RefreshCw,
  Search,
  Settings2,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/features/chat/chat-panel';
import { ChangeReviewDialog } from '@/features/changes/change-review-panel';
import { EditorWorkbench } from '@/features/editor/editor-workbench';
import { useEditorStore } from '@/features/editor/editor.store';
import { useProviderStore } from '@/features/providers/provider.store';
import { GitPanel } from '@/features/git/git-panel';
import { TerminalPanel } from '@/features/terminal/terminal-panel';
import { FileTree } from '@/features/workspace/file-tree';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';

export function WorkspacePage() {
  const { current, errorMessage, loading, refreshTree, search, searchQuery, searchResults } =
    useWorkspaceStore();
  const editor = useEditorStore();
  const resetEditor = useEditorStore((state) => state.reset);
  const handleEditorFileChange = useEditorStore((state) => state.handleFileChange);
  const handleWorkspaceFileChange = useWorkspaceStore((state) => state.handleFileChange);
  const [query, setQuery] = useState(searchQuery);
  const [bottomPanel, setBottomPanel] = useState<'terminal' | 'git' | null>(null);
  const provider = useProviderStore();
  const selectedProvider = provider.configurations.find(
    (configuration) => configuration.id === provider.selectedProviderId,
  );

  useEffect(() => {
    if (current !== null) {
      resetEditor(current.id);
    }
  }, [current, resetEditor]);

  useEffect(() => {
    return window.openCodeDesk.files.onChanged((event) => {
      void handleWorkspaceFileChange(event.workspaceId, event.relativePath);
      void handleEditorFileChange(event.workspaceId, event.relativePath);
    });
  }, [handleEditorFileChange, handleWorkspaceFileChange]);

  if (current === null) {
    return null;
  }

  const showSearchResults = searchQuery.trim() !== '';

  return (
    <main
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      data-testid="workspace-page"
    >
      <header className="flex h-12 shrink-0 items-center border-b border-zinc-800 px-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <div className="grid size-7 place-items-center rounded-lg bg-cyan-400 text-zinc-950">
            <ChevronRight className="size-4" aria-hidden="true" />
          </div>
          <span className="truncate font-semibold" data-testid="workspace-name">
            {current.name}
          </span>
          <span className="hidden truncate text-xs text-zinc-600 xl:inline">
            {current.rootPath}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            onClick={provider.openSettings}
          >
            <Settings2 className="size-3" />
            {selectedProvider === undefined
              ? '配置模型'
              : `${selectedProvider.displayName} · ${
                  provider.selectedModels[selectedProvider.id] ?? selectedProvider.defaultModel
                }`}
          </button>
          <Button size="sm" disabled>
            开始 Agent
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
          <div className="flex h-10 items-center gap-2 border-b border-zinc-800 px-2">
            <form
              className="flex min-w-0 flex-1 items-center rounded border border-zinc-800 bg-zinc-900 px-2"
              onSubmit={(event) => {
                event.preventDefault();
                void search(query);
              }}
            >
              <Search className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
              <input
                className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-xs outline-none placeholder:text-zinc-600"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文件名"
                aria-label="搜索文件名"
                data-testid="file-search"
              />
            </form>
            <button
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => void refreshTree()}
              title="刷新文件树"
              aria-label="刷新文件树"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-1" data-testid="file-tree">
            {loading && showSearchResults ? (
              <p className="px-2 py-3 text-xs text-zinc-600">正在搜索…</p>
            ) : showSearchResults ? (
              searchResults.length === 0 ? (
                <p className="px-2 py-3 text-xs text-zinc-600">没有匹配文件</p>
              ) : (
                searchResults.map((entry) => (
                  <button
                    key={entry.relativePath}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                    disabled={entry.restricted || entry.kind === 'directory'}
                    onClick={() => void editor.openFile(current.id, entry.relativePath)}
                  >
                    {entry.relativePath}
                  </button>
                ))
              )
            ) : (
              <FileTree workspaceId={current.id} />
            )}
          </div>
          <div className="border-t border-zinc-800 p-2 text-[11px] text-zinc-600">
            隐藏依赖、构建产物与 Git 内部目录
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <EditorWorkbench />
            <ChatPanel />
          </div>

          {bottomPanel === 'terminal' ? (
            <TerminalPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
          ) : null}
          {bottomPanel === 'git' ? (
            <GitPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
          ) : null}

          <div className="flex h-8 shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-500">
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'git' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'git' ? null : 'git'))}
              data-testid="toggle-git"
            >
              <GitBranch className="size-3" />
              Git
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'terminal' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'terminal' ? null : 'terminal'))}
              data-testid="toggle-terminal"
            >
              <TerminalSquare className="size-3" />
              终端
            </button>
            <span className="ml-auto">{editor.activePath ?? '未打开文件'}</span>
          </div>
        </section>
      </div>

      {errorMessage !== undefined || editor.errorMessage !== undefined ? (
        <div
          className="absolute bottom-10 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-red-900/70 bg-red-950 px-4 py-2 text-xs text-red-200 shadow-xl"
          role="alert"
        >
          {errorMessage ?? editor.errorMessage}
        </div>
      ) : null}
      <ChangeReviewDialog />
    </main>
  );
}
