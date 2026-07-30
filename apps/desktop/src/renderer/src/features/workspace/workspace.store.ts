import type { FileEntry, WorkspaceInfo } from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

interface WorkspaceState {
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly current: WorkspaceInfo | null;
  readonly recent: ReadonlyArray<WorkspaceInfo>;
  readonly directories: Readonly<Record<string, ReadonlyArray<FileEntry>>>;
  readonly expandedDirectories: ReadonlySet<string>;
  readonly searchResults: ReadonlyArray<FileEntry>;
  readonly searchQuery: string;
  readonly errorMessage: string | undefined;
  initialize(): Promise<void>;
  openDialog(): Promise<void>;
  openRecent(workspaceId: string): Promise<void>;
  loadDirectory(relativePath: string): Promise<void>;
  toggleDirectory(relativePath: string): Promise<void>;
  refreshTree(): Promise<void>;
  search(query: string): Promise<void>;
  handleFileChange(workspaceId: string, relativePath: string): Promise<void>;
  clearError(): void;
}

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

    if (workspace === null || trimmedQuery === '') {
      set({ searchResults: [] });
      return;
    }

    set({ loading: true, errorMessage: undefined });
    try {
      const searchResults = await window.openCodeDesk.files.searchFiles({
        workspaceId: workspace.id,
        query: trimmedQuery,
        limit: 100,
      });
      set({ searchResults, loading: false });
    } catch (error) {
      set({ loading: false, errorMessage: errorMessage(error) });
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
