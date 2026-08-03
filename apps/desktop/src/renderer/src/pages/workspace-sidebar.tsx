import { Code2, FilePlus2, FolderPlus, RefreshCw, Search, Square } from 'lucide-react';
import { useState } from 'react';

import { useEditorStore } from '@/features/editor/editor.store';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { translate } from '@/features/settings/i18n';
import { FileTree } from '@/features/workspace/file-tree';
import { useWorkspaceStore } from '@/features/workspace/workspace.store';
import { SidebarResizer } from './workspace-layout';

interface WorkspaceSidebarProps {
  readonly workspaceId: string;
  readonly width: number;
  setWidth(width: number): void;
}

export function WorkspaceSidebar({ workspaceId, width, setWidth }: WorkspaceSidebarProps) {
  const {
    cancelSearch,
    createDirectory,
    createFile,
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
  const [query, setQuery] = useState(searchQuery);
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const showSearchResults = searchQuery.trim() !== '';

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-950"
      style={{ width }}
      data-testid="sidebar-panel"
    >
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
            placeholder={searchMode === 'files' ? t('searchFileNames') : t('searchCodeContent')}
            aria-label={searchMode === 'files' ? t('searchFileNames') : t('searchCodeContent')}
            data-testid="file-search"
          />
        </form>
        <button
          className={`rounded p-1.5 hover:bg-zinc-800 hover:text-zinc-200 ${
            searchMode === 'content' ? 'text-cyan-300' : 'text-zinc-500'
          }`}
          onClick={() => setSearchMode(searchMode === 'files' ? 'content' : 'files')}
          title={searchMode === 'files' ? t('switchToContentSearch') : t('switchToFileSearch')}
          aria-label={searchMode === 'files' ? t('switchToContentSearch') : t('switchToFileSearch')}
          data-testid="toggle-search-mode"
        >
          <Code2 className="size-3.5" aria-hidden="true" />
        </button>
        {loading && showSearchResults ? (
          <button
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => void cancelSearch()}
            title={t('stopSearch')}
            aria-label={t('stopSearch')}
          >
            <Square className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={() => {
            const relativePath = window.prompt(t('newFilePathPrompt'))?.trim();
            if (relativePath === undefined || relativePath === '') return;
            void createFile(relativePath).then((created) => {
              if (created) void editor.openFile(workspaceId, relativePath);
            });
          }}
          title={t('newFile')}
          aria-label={t('newFile')}
          data-testid="create-file"
        >
          <FilePlus2 className="size-3.5" aria-hidden="true" />
        </button>
        <button
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={() => {
            const relativePath = window.prompt(t('newDirectoryPathPrompt'))?.trim();
            if (relativePath !== undefined && relativePath !== '')
              void createDirectory(relativePath);
          }}
          title={t('newDirectory')}
          aria-label={t('newDirectory')}
          data-testid="create-directory"
        >
          <FolderPlus className="size-3.5" aria-hidden="true" />
        </button>
        <button
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={() => void refreshTree()}
          title={t('refreshFileTree')}
          aria-label={t('refreshFileTree')}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-1" data-testid="file-tree">
        {loading && showSearchResults ? (
          <p className="px-2 py-3 text-xs text-zinc-600">{t('searching')}</p>
        ) : showSearchResults && searchMode === 'content' ? (
          textSearchResults.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-600">{t('noCodeMatches')}</p>
          ) : (
            textSearchResults.map((match) => (
              <button
                key={`${match.path}:${match.line}:${match.column}`}
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-zinc-800"
                onClick={() => void editor.openFile(workspaceId, match.path)}
                title={match.preview}
              >
                <span className="block truncate text-xs text-cyan-300">
                  {match.path}:{match.line}:{match.column}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">{match.preview}</span>
              </button>
            ))
          )
        ) : showSearchResults ? (
          searchResults.length === 0 ? (
            <p className="px-2 py-3 text-xs text-zinc-600">{t('noFileMatches')}</p>
          ) : (
            searchResults.map((entry) => (
              <button
                key={entry.relativePath}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                disabled={entry.restricted || entry.kind === 'directory'}
                onClick={() => void editor.openFile(workspaceId, entry.relativePath)}
              >
                {entry.relativePath}
              </button>
            ))
          )
        ) : (
          <FileTree workspaceId={workspaceId} />
        )}
      </div>
      <div className="border-t border-zinc-800 p-2 text-[11px] text-zinc-600">
        {t('hiddenDirectoriesHint')}
      </div>
      <SidebarResizer label={t('resizeFileSidebar')} value={width} setValue={setWidth} />
    </aside>
  );
}
