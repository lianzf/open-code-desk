import type { ChangeContents, FileChange, FileChangeSet } from '@open-code-desk/ipc-contracts';
import { create } from 'zustand';

import { rendererErrorMessage } from '../settings/error-i18n';

interface ChangeReviewState {
  readonly conversationId: string | undefined;
  readonly changeSets: ReadonlyArray<FileChangeSet>;
  readonly activeSetId: string | undefined;
  readonly activeChangeId: string | undefined;
  readonly contents: ChangeContents | undefined;
  readonly proposedDraft: string;
  readonly open: boolean;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly errorMessage: string | undefined;
  initialize(conversationId: string): Promise<void>;
  notifyReady(changeSetId: string): Promise<void>;
  show(changeSetId?: string): Promise<void>;
  close(): void;
  selectSet(changeSetId: string): Promise<void>;
  selectChange(changeId: string): Promise<void>;
  updateDraft(content: string): void;
  saveEdit(): Promise<void>;
  reviewSelected(decision: 'approve' | 'reject'): Promise<void>;
  reviewAll(decision: 'approve' | 'reject'): Promise<void>;
  applyActive(): Promise<void>;
  rollbackActive(): Promise<void>;
}

function readableError(error: unknown): string {
  return rendererErrorMessage(error, 'changeOperationFailed');
}

function replaceSet(
  changeSets: ReadonlyArray<FileChangeSet>,
  updated: FileChangeSet,
): ReadonlyArray<FileChangeSet> {
  const exists = changeSets.some((item) => item.id === updated.id);
  return exists
    ? changeSets.map((item) => (item.id === updated.id ? updated : item))
    : [updated, ...changeSets];
}

function firstReviewable(changeSet: FileChangeSet): FileChange | undefined {
  return (
    changeSet.changes.find((change) => change.status === 'pending') ??
    changeSet.changes.find((change) => change.status === 'approved') ??
    changeSet.changes[0]
  );
}

export const useChangeReviewStore = create<ChangeReviewState>((set, get) => ({
  conversationId: undefined,
  changeSets: [],
  activeSetId: undefined,
  activeChangeId: undefined,
  contents: undefined,
  proposedDraft: '',
  open: false,
  loading: false,
  busy: false,
  errorMessage: undefined,

  async initialize(conversationId) {
    if (get().conversationId === conversationId) {
      return;
    }
    set({
      conversationId,
      changeSets: [],
      activeSetId: undefined,
      activeChangeId: undefined,
      contents: undefined,
      proposedDraft: '',
      loading: true,
      errorMessage: undefined,
    });
    try {
      const changeSets = await window.openCodeDesk.changes.listForConversation({
        conversationId,
      });
      set({ changeSets, loading: false });
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  async notifyReady(changeSetId) {
    try {
      const changeSet = await window.openCodeDesk.changes.get({ changeSetId });
      set((state) => ({
        changeSets: replaceSet(state.changeSets, changeSet),
        activeSetId: changeSet.id,
        open: true,
        errorMessage: undefined,
      }));
      const first = firstReviewable(changeSet);
      if (first !== undefined) {
        await get().selectChange(first.id);
      }
    } catch (error) {
      set({ errorMessage: readableError(error) });
    }
  },

  async show(changeSetId) {
    const targetId = changeSetId ?? get().activeSetId ?? get().changeSets[0]?.id;
    if (targetId === undefined) {
      return;
    }
    set({ open: true });
    await get().selectSet(targetId);
  },

  close() {
    set({ open: false, errorMessage: undefined });
  },

  async selectSet(changeSetId) {
    set({ activeSetId: changeSetId, loading: true, errorMessage: undefined });
    try {
      const changeSet = await window.openCodeDesk.changes.get({ changeSetId });
      set((state) => ({
        changeSets: replaceSet(state.changeSets, changeSet),
        loading: false,
      }));
      const first = firstReviewable(changeSet);
      if (first !== undefined) {
        await get().selectChange(first.id);
      }
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  async selectChange(changeId) {
    set({ activeChangeId: changeId, loading: true, errorMessage: undefined });
    try {
      const contents = await window.openCodeDesk.changes.getContents({ changeId });
      if (get().activeChangeId === changeId) {
        set({
          contents,
          proposedDraft: contents.proposedContent,
          loading: false,
        });
      }
    } catch (error) {
      set({ loading: false, errorMessage: readableError(error) });
    }
  },

  updateDraft(content) {
    set({ proposedDraft: content });
  },

  async saveEdit() {
    const changeSet = get().changeSets.find((item) => item.id === get().activeSetId);
    const change = changeSet?.changes.find((item) => item.id === get().activeChangeId);
    if (change === undefined) {
      return;
    }
    set({ busy: true, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.changes.editProposal({
        changeId: change.id,
        expectedReviewDigest: change.reviewDigest,
        content: get().proposedDraft,
      });
      set((state) => ({
        changeSets: replaceSet(state.changeSets, updated),
        busy: false,
      }));
      await get().selectChange(change.id);
    } catch (error) {
      set({ busy: false, errorMessage: readableError(error) });
    }
  },

  async reviewSelected(decision) {
    const changeSet = get().changeSets.find((item) => item.id === get().activeSetId);
    const change = changeSet?.changes.find((item) => item.id === get().activeChangeId);
    if (change === undefined) {
      return;
    }
    set({ busy: true, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.changes.review({
        changeId: change.id,
        expectedReviewDigest: change.reviewDigest,
        decision,
      });
      set((state) => ({
        changeSets: replaceSet(state.changeSets, updated),
        busy: false,
      }));
    } catch (error) {
      set({ busy: false, errorMessage: readableError(error) });
    }
  },

  async reviewAll(decision) {
    const changeSet = get().changeSets.find((item) => item.id === get().activeSetId);
    if (changeSet === undefined) {
      return;
    }
    const visible = changeSet.changes.filter((change) =>
      ['pending', 'approved', 'rejected', 'failed'].includes(change.status),
    );
    if (visible.length === 0) {
      return;
    }
    set({ busy: true, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.changes.reviewMany({
        changeSetId: changeSet.id,
        entries: visible.map((change) => ({
          changeId: change.id,
          reviewDigest: change.reviewDigest,
        })),
        decision,
      });
      set((state) => ({
        changeSets: replaceSet(state.changeSets, updated),
        busy: false,
      }));
    } catch (error) {
      set({ busy: false, errorMessage: readableError(error) });
    }
  },

  async applyActive() {
    const changeSet = get().changeSets.find((item) => item.id === get().activeSetId);
    if (changeSet?.applyDigest === undefined) {
      return;
    }
    set({ busy: true, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.changes.apply({
        changeSetId: changeSet.id,
        expectedApplyDigest: changeSet.applyDigest,
      });
      set((state) => ({
        changeSets: replaceSet(state.changeSets, updated),
        busy: false,
      }));
    } catch (error) {
      set({ busy: false, errorMessage: readableError(error) });
    }
  },

  async rollbackActive() {
    const changeSet = get().changeSets.find((item) => item.id === get().activeSetId);
    if (changeSet?.applyDigest === undefined) {
      return;
    }
    set({ busy: true, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.changes.rollback({
        changeSetId: changeSet.id,
        expectedApplyDigest: changeSet.applyDigest,
      });
      set((state) => ({
        changeSets: replaceSet(state.changeSets, updated),
        busy: false,
      }));
    } catch (error) {
      set({ busy: false, errorMessage: readableError(error) });
    }
  },
}));
