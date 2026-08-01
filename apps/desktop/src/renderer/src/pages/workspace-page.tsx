import {
  ChevronRight,
  Bug,
  Code2,
  FilePlus2,
  FolderPlus,
  GitBranch,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  MonitorCog,
  Play,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AuditPanel } from '@/features/audit/audit-panel';
import { ChatPanel } from '@/features/chat/chat-panel';
import { ChangeReviewDialog } from '@/features/changes/change-review-panel';
import { DebugPanel } from '@/features/debug/debug-panel';
import { DebugToolbar } from '@/features/debug/debug-toolbar';
import { useDebugStore } from '@/features/debug/debug.store';
import { EditorWorkbench } from '@/features/editor/editor-workbench';
import { useEditorStore } from '@/features/editor/editor.store';
import { useProviderStore } from '@/features/providers/provider.store';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import { useApplicationShortcuts } from '@/features/settings/use-application-shortcuts';
import { GitPanel } from '@/features/git/git-panel';
import { RunOutputPanel } from '@/features/run/run-output-panel';
import { RunToolbar } from '@/features/run/run-toolbar';
import { TerminalPanel } from '@/features/terminal/terminal-panel';
import { FileTree } from '@/features/workspace/file-tree';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';

export function WorkspacePage() {
  const {
    cancelSearch,
    createDirectory,
    createFile,
    current,
    errorMessage,
    loading,
    refreshTree,
    search,
    searchMode,
    searchQuery,
    searchResults,
    setSearchMode,
    textSearchResults,
  } = useWorkspaceStore();
  const editor = useEditorStore();
  const openEditorFileAt = useEditorStore((state) => state.openFileAt);
  const resetEditor = useEditorStore((state) => state.reset);
  const handleEditorFileChange = useEditorStore((state) => state.handleFileChange);
  const handleWorkspaceFileChange = useWorkspaceStore((state) => state.handleFileChange);
  const [query, setQuery] = useState(searchQuery);
  const [bottomPanel, setBottomPanel] = useState<
    'terminal' | 'git' | 'audit' | 'run' | 'debug' | null
  >(null);
  const pausedSession = useDebugStore((state) =>
    state.sessions.find((session) => session.status === 'paused'),
  );
  const provider = useProviderStore();
  const openAppSettings = useAppSettingsStore((state) => state.openDialog);
  const settings = useAppSettingsStore((state) => state.settings);
  const t = (key: Parameters<typeof translate>[1]) => translate(settings.locale, key);
  const selectedProvider = provider.configurations.find(
    (configuration) => configuration.id === provider.selectedProviderId,
  );
  const workspaceShortcutHandlers = useMemo(
    () => ({
      toggleTerminal: () => setBottomPanel((value) => (value === 'terminal' ? null : 'terminal')),
      toggleGit: () => setBottomPanel((value) => (value === 'git' ? null : 'git')),
    }),
    [],
  );
  useApplicationShortcuts(settings.shortcuts, workspaceShortcutHandlers);

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

  useEffect(() => {
    const relativePath = pausedSession?.pause?.relativePath;
    const line = pausedSession?.pause?.line;
    if (current !== null && relativePath !== undefined && line !== undefined) {
      void openEditorFileAt(current.id, relativePath, line, pausedSession?.pause?.column);
      const frame = window.requestAnimationFrame(() => setBottomPanel('debug'));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [
    current,
    openEditorFileAt,
    pausedSession?.pause?.column,
    pausedSession?.pause?.line,
    pausedSession?.pause?.relativePath,
  ]);

  if (current === null) {
    return null;
  }

  const showSearchResults = searchQuery.trim() !== '';

  return (
    <main
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      data-testid="workspace-page"
    >
      <header className="flex shrink-0 flex-col border-b border-zinc-800 2xl:h-12 2xl:flex-row 2xl:items-center">
        <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 px-3 text-sm 2xl:h-auto 2xl:flex-1">
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
        <div className="flex h-12 w-full shrink-0 items-center gap-2 overflow-x-auto border-t border-zinc-800 px-3 [&>*]:shrink-0 2xl:ml-auto 2xl:h-auto 2xl:w-auto 2xl:border-t-0 2xl:pl-0">
          <RunToolbar workspaceId={current.id} onShowOutput={() => setBottomPanel('run')} />
          <DebugToolbar workspaceId={current.id} onShowDebug={() => setBottomPanel('debug')} />
          <button
            className="rounded border border-zinc-800 p-1.5 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
            onClick={openAppSettings}
            aria-label={t('appSettings')}
            title={`${t('appSettings')} (${settings.shortcuts.openApplicationSettings})`}
            data-testid="open-app-settings"
          >
            <MonitorCog className="size-3" />
          </button>
          <button
            className="flex items-center gap-1.5 rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            onClick={provider.openSettings}
            title={`${t('configureModel')} (${settings.shortcuts.openProviderSettings})`}
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
                placeholder={searchMode === 'files' ? '搜索文件名' : '搜索代码内容'}
                aria-label={searchMode === 'files' ? '搜索文件名' : '搜索代码内容'}
                data-testid="file-search"
              />
            </form>
            <button
              className={`rounded p-1.5 hover:bg-zinc-800 hover:text-zinc-200 ${
                searchMode === 'content' ? 'text-cyan-300' : 'text-zinc-500'
              }`}
              onClick={() => setSearchMode(searchMode === 'files' ? 'content' : 'files')}
              title={searchMode === 'files' ? '切换到代码内容搜索' : '切换到文件名搜索'}
              aria-label={searchMode === 'files' ? '切换到代码内容搜索' : '切换到文件名搜索'}
              data-testid="toggle-search-mode"
            >
              <Code2 className="size-3.5" aria-hidden="true" />
            </button>
            {loading && showSearchResults ? (
              <button
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() => void cancelSearch()}
                title="停止搜索"
                aria-label="停止搜索"
              >
                <Square className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => {
                const relativePath = window.prompt('输入新文件的工作区相对路径')?.trim();
                if (relativePath === undefined || relativePath === '') {
                  return;
                }
                void createFile(relativePath).then((created) => {
                  if (created) {
                    void editor.openFile(current.id, relativePath);
                  }
                });
              }}
              title="新建文件"
              aria-label="新建文件"
              data-testid="create-file"
            >
              <FilePlus2 className="size-3.5" aria-hidden="true" />
            </button>
            <button
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => {
                const relativePath = window.prompt('输入新目录的工作区相对路径')?.trim();
                if (relativePath !== undefined && relativePath !== '') {
                  void createDirectory(relativePath);
                }
              }}
              title="新建目录"
              aria-label="新建目录"
              data-testid="create-directory"
            >
              <FolderPlus className="size-3.5" aria-hidden="true" />
            </button>
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
            ) : showSearchResults && searchMode === 'content' ? (
              textSearchResults.length === 0 ? (
                <p className="px-2 py-3 text-xs text-zinc-600">没有匹配代码</p>
              ) : (
                textSearchResults.map((match) => (
                  <button
                    key={`${match.path}:${match.line}:${match.column}`}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-zinc-800"
                    onClick={() => void editor.openFile(current.id, match.path)}
                    title={match.preview}
                  >
                    <span className="block truncate text-xs text-cyan-300">
                      {match.path}:{match.line}:{match.column}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {match.preview}
                    </span>
                  </button>
                ))
              )
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
          {bottomPanel === 'audit' ? (
            <AuditPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
          ) : null}
          {bottomPanel === 'run' ? <RunOutputPanel onClose={() => setBottomPanel(null)} /> : null}
          {bottomPanel === 'debug' ? (
            <DebugPanel workspaceId={current.id} onClose={() => setBottomPanel(null)} />
          ) : null}

          <div className="flex h-8 shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-500">
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'debug' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'debug' ? null : 'debug'))}
              data-testid="toggle-debug"
            >
              <Bug className="size-3" />
              调试
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'run' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'run' ? null : 'run'))}
              data-testid="toggle-run-output"
            >
              <Play className="size-3" />
              运行
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'git' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'git' ? null : 'git'))}
              title={settings.shortcuts.toggleGit}
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
              title={settings.shortcuts.toggleTerminal}
              data-testid="toggle-terminal"
            >
              <TerminalSquare className="size-3" />
              终端
            </button>
            <button
              className={`flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800 hover:text-zinc-200 ${
                bottomPanel === 'audit' ? 'bg-zinc-800 text-zinc-200' : ''
              }`}
              onClick={() => setBottomPanel((value) => (value === 'audit' ? null : 'audit'))}
              data-testid="toggle-audit"
            >
              <ShieldCheck className="size-3" />
              审计
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
