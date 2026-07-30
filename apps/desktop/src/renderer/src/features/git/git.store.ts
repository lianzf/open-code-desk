import type { GitDiff, GitStatus } from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

interface GitState {
  readonly workspaceId: string | undefined;
  readonly status: GitStatus | undefined;
  readonly diff: GitDiff | undefined;
  readonly selectedPath: string | undefined;
  readonly staged: boolean;
  readonly loading: boolean;
  readonly errorMessage: string | undefined;
  initialize(workspaceId: string): Promise<void>;
  refresh(): Promise<void>;
  selectPath(path: string | undefined): Promise<void>;
  setStaged(staged: boolean): Promise<void>;
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  }
  return '无法读取 Git 信息。';
}

async function loadDiff(
  workspaceId: string,
  staged: boolean,
  path: string | undefined,
): Promise<GitDiff> {
  return window.openCodeDesk.git.diff({
    workspaceId,
    staged,
    maxCharacters: 200_000,
    ...(path === undefined ? {} : { path }),
  });
}

export const useGitStore = create<GitState>((set, get) => ({
  workspaceId: undefined,
  status: undefined,
  diff: undefined,
  selectedPath: undefined,
  staged: false,
  loading: false,
  errorMessage: undefined,

  async initialize(workspaceId) {
    if (get().workspaceId !== workspaceId) {
      set({
        workspaceId,
        status: undefined,
        diff: undefined,
        selectedPath: undefined,
        staged: false,
        errorMessage: undefined,
      });
    }
    await get().refresh();
  },

  async refresh() {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) {
      return;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const status = await window.openCodeDesk.git.status({ workspaceId });
      set({ status, loading: false });
      if (!status.isRepository) {
        set({ diff: undefined, selectedPath: undefined });
        return;
      }
      const selectedPath = get().selectedPath;
      const selectedStillExists =
        selectedPath === undefined || status.files.some((file) => file.path === selectedPath);
      await get().selectPath(selectedStillExists ? selectedPath : undefined);
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  async selectPath(path) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined || get().status?.isRepository !== true) {
      return;
    }
    set({ selectedPath: path, loading: true, errorMessage: undefined });
    try {
      const diff = await loadDiff(workspaceId, get().staged, path);
      if (get().workspaceId === workspaceId && get().selectedPath === path) {
        set({ diff, loading: false });
      }
    } catch (error) {
      set({ diff: undefined, loading: false, errorMessage: readableError(error) });
    }
  },

  async setStaged(staged) {
    set({ staged });
    await get().selectPath(get().selectedPath);
  },
}));
