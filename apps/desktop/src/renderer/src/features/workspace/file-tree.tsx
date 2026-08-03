import {
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  LockKeyhole,
  Paperclip,
  Pencil,
  Trash2,
} from 'lucide-react';

import { useConversationContextStore } from '@/features/context/context.store';
import { useAppSettingsStore } from '@/features/settings/app-settings.store';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/features/editor/editor.store';
import { useWorkspaceStore } from './workspace.store';
import { translateWorkspace } from './workspace-i18n';

interface TreeLevelProps {
  readonly directory: string;
  readonly depth: number;
  readonly workspaceId: string;
}

function TreeLevel({ depth, directory, workspaceId }: TreeLevelProps) {
  const { deletePath, directories, expandedDirectories, movePath, toggleDirectory } =
    useWorkspaceStore();
  const openFile = useEditorStore((state) => state.openFile);
  const discardEditorPath = useEditorStore((state) => state.discardPath);
  const editorTabs = useEditorStore((state) => state.tabs);
  const saveDirectory = useConversationContextStore((state) => state.saveDirectory);
  const contextConversationId = useConversationContextStore((state) => state.conversationId);
  const entries = directories[directory] ?? [];
  const locale = useAppSettingsStore((state) => state.settings.locale);
  const t = (
    key: Parameters<typeof translateWorkspace>[1],
    values?: Record<string, string | number>,
  ) => translateWorkspace(locale, key, values);

  return (
    <ul role="tree" aria-label={directory === '' ? t('projectFiles') : undefined}>
      {entries.map((entry) => {
        const expanded = expandedDirectories.has(entry.relativePath);
        return (
          <li
            key={entry.relativePath}
            role="treeitem"
            aria-expanded={entry.kind === 'directory' ? expanded : undefined}
          >
            <div className="group flex items-center">
              <button
                className={cn(
                  'flex h-7 min-w-0 flex-1 items-center gap-1.5 truncate rounded px-1.5 text-left text-xs hover:bg-zinc-800',
                  entry.restricted ? 'cursor-not-allowed text-zinc-600' : 'text-zinc-300',
                )}
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                disabled={entry.restricted}
                title={
                  entry.restricted
                    ? t('protectedPath', { path: entry.relativePath })
                    : entry.relativePath
                }
                onClick={() => {
                  if (entry.kind === 'directory') {
                    void toggleDirectory(entry.relativePath);
                  } else {
                    void openFile(workspaceId, entry.relativePath);
                  }
                }}
                data-testid={`tree-entry-${entry.relativePath}`}
              >
                {entry.kind === 'directory' ? (
                  <>
                    <ChevronRight
                      className={cn(
                        'size-3 shrink-0 transition-transform',
                        expanded && 'rotate-90',
                      )}
                      aria-hidden="true"
                    />
                    {expanded ? (
                      <FolderOpen className="size-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
                    ) : (
                      <Folder className="size-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-3 shrink-0" />
                    <FileCode2 className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                  </>
                )}
                <span className="truncate">{entry.name}</span>
                {entry.restricted ? (
                  <LockKeyhole className="ml-auto size-3 shrink-0" aria-hidden="true" />
                ) : null}
              </button>
              {entry.kind === 'directory' &&
              !entry.restricted &&
              contextConversationId !== undefined ? (
                <button
                  className="mr-1 hidden rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-cyan-300 group-hover:block focus:block"
                  onClick={() => void saveDirectory(workspaceId, entry.relativePath)}
                  title={t('addDirectoryStructureContext', { path: entry.relativePath })}
                  aria-label={t('addDirectoryContext', { path: entry.relativePath })}
                >
                  <Paperclip className="size-3" />
                </button>
              ) : null}
              {!entry.restricted ? (
                <>
                  <button
                    className="hidden rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-cyan-300 group-hover:block focus:block"
                    onClick={() => {
                      const destinationPath = window
                        .prompt(t('movePathPrompt'), entry.relativePath)
                        ?.trim();
                      if (
                        destinationPath === undefined ||
                        destinationPath === '' ||
                        destinationPath === entry.relativePath
                      ) {
                        return;
                      }
                      const hasDirtyTab = editorTabs.some(
                        (tab) =>
                          (tab.relativePath === entry.relativePath ||
                            tab.relativePath.startsWith(`${entry.relativePath}/`)) &&
                          tab.content !== tab.savedContent,
                      );
                      if (hasDirtyTab && !window.confirm(t('unsavedMoveWarning'))) {
                        return;
                      }
                      void movePath(entry.relativePath, destinationPath).then((moved) => {
                        if (moved) {
                          discardEditorPath(entry.relativePath);
                        }
                      });
                    }}
                    title={t('movePath', { path: entry.relativePath })}
                    aria-label={t('movePath', { path: entry.relativePath })}
                    data-testid={`move-path-${entry.relativePath}`}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    className="mr-1 hidden rounded p-1 text-zinc-600 hover:bg-red-950 hover:text-red-300 group-hover:block focus:block"
                    onClick={() => {
                      const hasDirtyTab = editorTabs.some(
                        (tab) =>
                          (tab.relativePath === entry.relativePath ||
                            tab.relativePath.startsWith(`${entry.relativePath}/`)) &&
                          tab.content !== tab.savedContent,
                      );
                      const warning = hasDirtyTab
                        ? t('unsavedDeleteWarning', { path: entry.relativePath })
                        : t('deleteWarning', { path: entry.relativePath });
                      if (!window.confirm(warning)) {
                        return;
                      }
                      void deletePath(entry.relativePath).then((deleted) => {
                        if (deleted) {
                          discardEditorPath(entry.relativePath);
                        }
                      });
                    }}
                    title={t('deletePath', { path: entry.relativePath })}
                    aria-label={t('deletePath', { path: entry.relativePath })}
                    data-testid={`delete-path-${entry.relativePath}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
              ) : null}
            </div>
            {entry.kind === 'directory' && expanded ? (
              <TreeLevel
                directory={entry.relativePath}
                depth={depth + 1}
                workspaceId={workspaceId}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function FileTree({ workspaceId }: { readonly workspaceId: string }) {
  return <TreeLevel directory="" depth={0} workspaceId={workspaceId} />;
}
