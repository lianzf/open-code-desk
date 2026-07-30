import { ChevronRight, FileCode2, Folder, FolderOpen, LockKeyhole } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useEditorStore } from '@/features/editor/editor.store';
import { useWorkspaceStore } from './workspace.store';

interface TreeLevelProps {
  readonly directory: string;
  readonly depth: number;
  readonly workspaceId: string;
}

function TreeLevel({ depth, directory, workspaceId }: TreeLevelProps) {
  const { directories, expandedDirectories, toggleDirectory } = useWorkspaceStore();
  const openFile = useEditorStore((state) => state.openFile);
  const entries = directories[directory] ?? [];

  return (
    <ul role="tree" aria-label={directory === '' ? '项目文件' : undefined}>
      {entries.map((entry) => {
        const expanded = expandedDirectories.has(entry.relativePath);
        return (
          <li
            key={entry.relativePath}
            role="treeitem"
            aria-expanded={entry.kind === 'directory' ? expanded : undefined}
          >
            <button
              className={cn(
                'flex h-7 w-full items-center gap-1.5 truncate rounded px-1.5 text-left text-xs hover:bg-zinc-800',
                entry.restricted ? 'cursor-not-allowed text-zinc-600' : 'text-zinc-300',
              )}
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              disabled={entry.restricted}
              title={entry.restricted ? `${entry.relativePath}（受保护）` : entry.relativePath}
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
                    className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')}
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
