import type { FileEntry, TextSearchMatch, WorkspaceInfo } from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

type SearchMode = 'files' | 'content';

interface WorkspaceState {
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly current: WorkspaceInfo | null;
  readonly recent: ReadonlyArray<WorkspaceInfo>;
  readonly directories: Readonly<Record<string, ReadonlyArray<FileEntry>>>;
  readonly expandedDirectories: ReadonlySet<string>;
  readonly searchResults: ReadonlyArray<FileEntry>;
  readonly textSearchResults: ReadonlyArray<TextSearchMatch>;
  readonly searchMode: SearchMode;
  readonly searchQuery: string;
  readonly errorMessage: string | undefined;
  initialize(): Promise<void>;
  openDialog(): Promise<void>;
  openRecent(workspaceId: string): Promise<void>;
  loadDirectory(relativePath: string): Promise<void>;
  toggleDirectory(relativePath: string): Promise<void>;
  refreshTree(): Promise<void>;
  search(query: string): Promise<void>;
  cancelSearch(): Promise<void>;
  setSearchMode(mode: SearchMode): void;
  createFile(relativePath: string): Promise<boolean>;
  createDirectory(relativePath: string): Promise<boolean>;
  movePath(sourcePath: string, destinationPath: string): Promise<boolean>;
  deletePath(relativePath: string): Promise<boolean>;
  handleFileChange(workspaceId: string, relativePath: string): Promise<void>;
  clearError(): void;
}

let activeSearchRequestId: string | undefined;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '工作区操作失败，请重试。';
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  initialized: false,
  loading: false,
  current: null,
  recent: [],
  directories: {},
  expandedDirectories: new Set<string>(),
  searchResults: [],
  textSearchResults: [],
  searchMode: 'files',
  searchQuery: '',
  errorMessage: undefined,

  async initialize() {
    if (get().initialized || get().loading) {
      return;
    }

    set({ loading: true, errorMessage: undefined });
    try {
      const [current, recent] = await Promise.all([
        window.openCodeDesk.workspace.getCurrent(),
        window.openCodeDesk.workspace.listRecent(),
      ]);
      set({ initialized: true, loading: false, current, recent });
      if (current !== null) {
        await get().loadDirectory('');
      }
    } catch (error) {
      set({ initialized: true, loading: false, errorMessage: errorMessage(error) });
    }
  },

  async openDialog() {
    set({ loading: true, errorMessage: undefined });
    try {
      const current = await window.openCodeDesk.workspace.openDialog();
      if (current === null) {
        set({ loading: false });
        return;
      }

      const recent = await window.openCodeDesk.workspace.listRecent();
      set({
        loading: false,
        current,
        recent,
        directories: {},
        expandedDirectories: new Set<string>(),
        searchResults: [],
        textSearchResults: [],
        searchQuery: '',
      });
      await get().loadDirectory('');
    } catch (error) {
      set({ loading: false, errorMessage: errorMessage(error) });
    }
  },

  async openRecent(workspaceId) {
    set({ loading: true, errorMessage: undefined });
    try {
      const current = await window.openCodeDesk.workspace.openRecent({ workspaceId });
      const recent = await window.openCodeDesk.workspace.listRecent();
      set({
        loading: false,
        current,
        recent,
        directories: {},
        expandedDirectories: new Set<string>(),
        searchResults: [],
        textSearchResults: [],
        searchQuery: '',
      });
      await get().loadDirectory('');
    } catch (error) {
      set({ loading: false, errorMessage: errorMessage(error) });
    }
  },

  async loadDirectory(relativePath) {
    const workspace = get().current;
    if (workspace === null) {
      return;
    }

    try {
      const entries = await window.openCodeDesk.files.listDirectory({
        workspaceId: workspace.id,
        relativePath,
      });
      set((state) => ({
        directories: { ...state.directories, [relativePath]: entries },
        errorMessage: undefined,
      }));
    } catch (error) {
      set({ errorMessage: errorMessage(error) });
    }
  },

  async toggleDirectory(relativePath) {
    const expanded = new Set(get().expandedDirectories);
    if (expanded.has(relativePath)) {
      expanded.delete(relativePath);
      set({ expandedDirectories: expanded });
      return;
    }

    expanded.add(relativePath);
    set({ expandedDirectories: expanded });
    if (get().directories[relativePath] === undefined) {
      await get().loadDirectory(relativePath);
    }
  },

  async refreshTree() {
    const expanded = ['', ...get().expandedDirectories];
    set({ directories: {}, errorMessage: undefined });
    await Promise.all(expanded.map((relativePath) => get().loadDirectory(relativePath)));
  },

  async search(query) {
    const workspace = get().current;
    const trimmedQuery = query.trim();
    set({ searchQuery: query });
    await get().cancelSearch();

    if (workspace === null || trimmedQuery === '') {
      set({ searchResults: [], textSearchResults: [] });
      return;
    }

    set({ loading: true, errorMessage: undefined });
    const searchMode = get().searchMode;
    try {
      if (searchMode === 'content') {
        const requestId = crypto.randomUUID();
        activeSearchRequestId = requestId;
        const result = await window.openCodeDesk.files.searchText({
          requestId,
          workspaceId: workspace.id,
          query: trimmedQuery,
          path: '',
          caseSensitive: false,
          limit: 100,
        });
        if (activeSearchRequestId === requestId) {
          activeSearchRequestId = undefined;
          set({ textSearchResults: result.matches, searchResults: [], loading: false });
        }
      } else {
        const searchResults = await window.openCodeDesk.files.searchFiles({
          workspaceId: workspace.id,
          query: trimmedQuery,
          limit: 100,
        });
        set({ searchResults, textSearchResults: [], loading: false });
      }
    } catch (error) {
      if (searchMode === 'content' && activeSearchRequestId === undefined) {
        return;
      }
      activeSearchRequestId = undefined;
      set({ loading: false, errorMessage: errorMessage(error) });
    }
  },

  async cancelSearch() {
    const requestId = activeSearchRequestId;
    activeSearchRequestId = undefined;
    if (requestId !== undefined) {
      await window.openCodeDesk.files.cancelSearch({ requestId }).catch(() => undefined);
    }
    set({ loading: false });
  },

  setSearchMode(mode) {
    void get().cancelSearch();
    set({ searchMode: mode, searchResults: [], textSearchResults: [] });
  },

  async createFile(relativePath) {
    const workspace = get().current;
    if (workspace === null) {
      return false;
    }
    try {
      await window.openCodeDesk.files.createFile({
        workspaceId: workspace.id,
        relativePath,
        content: '',
      });
      await get().refreshTree();
      return true;
    } catch (error) {
      set({ errorMessage: errorMessage(error) });
      return false;
    }
  },

  async createDirectory(relativePath) {
    const workspace = get().current;
    if (workspace === null) {
      return false;
    }
    try {
      await window.openCodeDesk.files.createDirectory({
        workspaceId: workspace.id,
        relativePath,
      });
      await get().refreshTree();
      return true;
    } catch (error) {
      set({ errorMessage: errorMessage(error) });
      return false;
    }
  },

  async movePath(sourcePath, destinationPath) {
    const workspace = get().current;
    if (workspace === null) {
      return false;
    }
    try {
      await window.openCodeDesk.files.movePath({
        workspaceId: workspace.id,
        sourcePath,
        destinationPath,
      });
      const expandedDirectories = new Set(
        [...get().expandedDirectories].map((path) =>
          path === sourcePath || path.startsWith(`${sourcePath}/`)
            ? `${destinationPath}${path.slice(sourcePath.length)}`
            : path,
        ),
      );
      set({ expandedDirectories });
      await get().refreshTree();
      return true;
    } catch (error) {
      set({ errorMessage: errorMessage(error) });
      return false;
    }
  },

  async deletePath(relativePath) {
    const workspace = get().current;
    if (workspace === null) {
      return false;
    }
    try {
      await window.openCodeDesk.files.deletePath({
        workspaceId: workspace.id,
        relativePath,
        confirmed: true,
      });
      const expandedDirectories = new Set(
        [...get().expandedDirectories].filter(
          (path) => path !== relativePath && !path.startsWith(`${relativePath}/`),
        ),
      );
      set({ expandedDirectories });
      await get().refreshTree();
      return true;
    } catch (error) {
      set({ errorMessage: errorMessage(error) });
      return false;
    }
  },

  async handleFileChange(workspaceId, relativePath) {
    if (get().current?.id !== workspaceId) {
      return;
    }

    const separatorIndex = relativePath.lastIndexOf('/');
    const parentDirectory = separatorIndex === -1 ? '' : relativePath.slice(0, separatorIndex);
    await get().loadDirectory(parentDirectory);
  },

  clearError() {
    set({ errorMessage: undefined });
  },
}));
