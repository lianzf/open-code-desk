import type {
  ConversationContextItem,
  SaveConversationContextRequest,
} from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

type SaveContextInput = Omit<SaveConversationContextRequest, 'conversationId'>;

interface ConversationContextState {
  readonly conversationId: string | undefined;
  readonly items: ReadonlyArray<ConversationContextItem>;
  readonly loading: boolean;
  readonly errorMessage: string | undefined;
  initialize(conversationId: string): Promise<void>;
  refresh(): Promise<void>;
  pickImage(): Promise<void>;
  save(input: SaveContextInput): Promise<void>;
  saveDirectory(workspaceId: string, relativePath: string): Promise<void>;
  remove(contextItemId: string): Promise<void>;
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  }
  return '上下文操作失败，请重试。';
}

function sorted(items: ReadonlyArray<ConversationContextItem>) {
  return [...items].sort(
    (left, right) =>
      right.priority - left.priority || left.createdAt.localeCompare(right.createdAt),
  );
}

export const useConversationContextStore = create<ConversationContextState>((set, get) => ({
  conversationId: undefined,
  items: [],
  loading: false,
  errorMessage: undefined,

  async initialize(conversationId) {
    if (get().conversationId !== conversationId) {
      set({ conversationId, items: [], errorMessage: undefined });
    }
    await get().refresh();
  },

  async refresh() {
    const conversationId = get().conversationId;
    if (conversationId === undefined) {
      return;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const items = await window.openCodeDesk.context.list({ conversationId });
      if (get().conversationId === conversationId) {
        set({ items: sorted(items), loading: false });
      }
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  async save(input) {
    const conversationId = get().conversationId;
    if (conversationId === undefined || input.content.trim() === '') {
      return;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const saved = await window.openCodeDesk.context.save({ conversationId, ...input });
      if (get().conversationId === conversationId) {
        set((state) => ({
          loading: false,
          items: sorted([...state.items.filter((item) => item.id !== saved.id), saved]),
        }));
      }
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  async pickImage() {
    const conversationId = get().conversationId;
    if (conversationId === undefined) {
      return;
    }
    set({ loading: true, errorMessage: undefined });
    try {
      const saved = await window.openCodeDesk.context.pickImage({ conversationId });
      if (get().conversationId === conversationId) {
        set((state) => ({
          loading: false,
          items:
            saved === null
              ? state.items
              : sorted([...state.items.filter((item) => item.id !== saved.id), saved]),
        }));
      }
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  async saveDirectory(workspaceId, relativePath) {
    try {
      const entries = await window.openCodeDesk.files.listDirectory({
        workspaceId,
        relativePath,
      });
      const title = relativePath === '' ? 'Workspace root' : relativePath;
      const content = entries
        .filter((entry) => !entry.restricted)
        .map(
          (entry) => `${entry.kind === 'directory' ? 'directory' : 'file'}\t${entry.relativePath}`,
        )
        .join('\n');
      await get().save({
        type: 'directory',
        title,
        content: content || '(empty directory)',
        priority: 65,
        sourceKey: `directory:${relativePath || '.'}`,
      });
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  async remove(contextItemId) {
    const conversationId = get().conversationId;
    if (conversationId === undefined) {
      return;
    }
    try {
      const result = await window.openCodeDesk.context.delete({
        conversationId,
        contextItemId,
      });
      if (result.deleted && get().conversationId === conversationId) {
        set((state) => ({ items: state.items.filter((item) => item.id !== contextItemId) }));
      }
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },
}));
