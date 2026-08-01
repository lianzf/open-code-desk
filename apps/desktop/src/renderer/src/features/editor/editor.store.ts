import { create } from 'zustand';

export interface EditorTab {
  readonly relativePath: string;
  readonly name: string;
  readonly content: string;
  readonly savedContent: string;
  readonly contentHash: string;
  readonly language: string;
  readonly modifiedAt: string;
}

export interface EditorNavigationTarget {
  readonly requestId: string;
  readonly relativePath: string;
  readonly line: number;
  readonly column: number;
}

interface EditorState {
  readonly workspaceId: string | null;
  readonly tabs: ReadonlyArray<EditorTab>;
  readonly activePath: string | null;
  readonly navigationTarget: EditorNavigationTarget | undefined;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly errorMessage: string | undefined;
  reset(workspaceId: string): void;
  openFile(workspaceId: string, relativePath: string): Promise<void>;
  openFileAt(
    workspaceId: string,
    relativePath: string,
    line: number,
    column?: number,
  ): Promise<void>;
  setActive(relativePath: string): void;
  updateContent(content: string): void;
  closeFile(relativePath: string): void;
  discardPath(relativePath: string): void;
  saveActive(): Promise<void>;
  handleFileChange(workspaceId: string, relativePath: string): Promise<void>;
  clearError(): void;
}

function nameFromPath(relativePath: string): string {
  return relativePath.split('/').at(-1) ?? relativePath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '文件操作失败，请重试。';
}

export const useEditorStore = create<EditorState>((set, get) => ({
  workspaceId: null,
  tabs: [],
  activePath: null,
  navigationTarget: undefined,
  loading: false,
  saving: false,
  errorMessage: undefined,

  reset(workspaceId) {
    if (get().workspaceId !== workspaceId) {
      set({
        workspaceId,
        tabs: [],
        activePath: null,
        navigationTarget: undefined,
        errorMessage: undefined,
      });
    }
  },

  async openFileAt(workspaceId, relativePath, line, column = 1) {
    await get().openFile(workspaceId, relativePath);
    if (get().workspaceId === workspaceId && get().activePath === relativePath) {
      set({
        navigationTarget: {
          requestId: crypto.randomUUID(),
          relativePath,
          line,
          column,
        },
      });
    }
  },

  async openFile(workspaceId, relativePath) {
    const existing = get().tabs.find((tab) => tab.relativePath === relativePath);
    if (existing !== undefined) {
      set({ activePath: relativePath, errorMessage: undefined });
      return;
    }

    set({ loading: true, errorMessage: undefined });
    try {
      const file = await window.openCodeDesk.files.readFile({ workspaceId, relativePath });
      const tab: EditorTab = {
        relativePath,
        name: nameFromPath(relativePath),
        content: file.content,
        savedContent: file.content,
        contentHash: file.contentHash,
        language: file.language,
        modifiedAt: file.modifiedAt,
      };
      set((state) => ({
        workspaceId,
        loading: false,
        tabs: [...state.tabs, tab],
        activePath: relativePath,
      }));
    } catch (error) {
      set({ loading: false, errorMessage: errorMessage(error) });
    }
  },

  setActive(relativePath) {
    set({ activePath: relativePath });
  },

  updateContent(content) {
    const activePath = get().activePath;
    if (activePath === null) {
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.relativePath === activePath ? { ...tab, content } : tab)),
    }));
  },

  closeFile(relativePath) {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.relativePath === relativePath);
    if (tab?.content !== tab?.savedContent && !window.confirm('该文件有未保存修改，确定关闭吗？')) {
      return;
    }

    const tabIndex = state.tabs.findIndex((candidate) => candidate.relativePath === relativePath);
    const tabs = state.tabs.filter((candidate) => candidate.relativePath !== relativePath);
    const nextActive =
      state.activePath === relativePath
        ? (tabs[Math.min(tabIndex, tabs.length - 1)]?.relativePath ?? null)
        : state.activePath;
    set({
      tabs,
      activePath: nextActive,
      navigationTarget:
        state.navigationTarget?.relativePath === relativePath ? undefined : state.navigationTarget,
    });
  },

  discardPath(relativePath) {
    const state = get();
    const matchesPath = (path: string) =>
      path === relativePath || path.startsWith(`${relativePath}/`);
    const tabs = state.tabs.filter((tab) => !matchesPath(tab.relativePath));
    set({
      tabs,
      activePath:
        state.activePath !== null && matchesPath(state.activePath)
          ? (tabs[0]?.relativePath ?? null)
          : state.activePath,
      navigationTarget:
        state.navigationTarget !== undefined && matchesPath(state.navigationTarget.relativePath)
          ? undefined
          : state.navigationTarget,
    });
  },

  async saveActive() {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.relativePath === state.activePath);
    if (state.workspaceId === null || tab === undefined || tab.content === tab.savedContent) {
      return;
    }

    set({ saving: true, errorMessage: undefined });
    try {
      const saved = await window.openCodeDesk.files.writeFile({
        workspaceId: state.workspaceId,
        relativePath: tab.relativePath,
        content: tab.content,
        expectedHash: tab.contentHash,
      });
      set((current) => ({
        saving: false,
        tabs: current.tabs.map((candidate) =>
          candidate.relativePath === tab.relativePath
            ? {
                ...candidate,
                savedContent: candidate.content,
                contentHash: saved.contentHash,
                modifiedAt: saved.modifiedAt,
              }
            : candidate,
        ),
      }));
    } catch (error) {
      set({ saving: false, errorMessage: errorMessage(error) });
    }
  },

  async handleFileChange(workspaceId, relativePath) {
    const state = get();
    const tab = state.tabs.find((candidate) => candidate.relativePath === relativePath);

    if (state.workspaceId !== workspaceId || tab === undefined || state.saving) {
      return;
    }

    try {
      const file = await window.openCodeDesk.files.readFile({ workspaceId, relativePath });

      if (file.contentHash === tab.contentHash) {
        return;
      }

      if (tab.content !== tab.savedContent) {
        set({
          errorMessage: `${relativePath} 已在磁盘上发生变化。请复制未保存内容并重新打开文件，系统不会覆盖外部修改。`,
        });
        return;
      }

      set((current) => ({
        tabs: current.tabs.map((candidate) =>
          candidate.relativePath === relativePath
            ? {
                ...candidate,
                content: file.content,
                savedContent: file.content,
                contentHash: file.contentHash,
                modifiedAt: file.modifiedAt,
              }
            : candidate,
        ),
      }));
    } catch {
      set({
        errorMessage: `${relativePath} 已被移动、删除或暂时无法读取。编辑器保留当前内容，不会自动写回磁盘。`,
      });
    }
  },

  clearError() {
    set({ errorMessage: undefined });
  },
}));
