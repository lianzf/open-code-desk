import type { DebugContextSectionKey, DebugContextSnapshot } from '@open-code-desk/ipc-contracts';

import { currentRendererLocale } from '../settings/error-i18n';

import {
  readableDebugError,
  selectedDebugSession,
  type DebugStoreGet,
  type DebugStoreSet,
} from './debug-store.helpers';

export async function previewDebugContext(
  get: DebugStoreGet,
  set: DebugStoreSet,
  conversationId: string,
): Promise<DebugContextSnapshot | undefined> {
  const session = selectedDebugSession(get());
  if (session?.status !== 'paused') return undefined;
  set({ contextLoading: true, contextPreview: undefined, errorMessage: undefined });
  try {
    const snapshot = await window.openCodeDesk.debug.previewContext({
      sessionId: session.id,
      conversationId,
      locale: currentRendererLocale(),
    });
    set({ contextLoading: false, contextPreview: snapshot });
    return snapshot;
  } catch (error) {
    set({ contextLoading: false, errorMessage: readableDebugError(error) });
    return undefined;
  }
}

export async function attachDebugContext(
  get: DebugStoreGet,
  set: DebugStoreSet,
  conversationId: string,
  selectedSections: ReadonlyArray<DebugContextSectionKey>,
): Promise<{ readonly prompt: string } | undefined> {
  const preview = get().contextPreview;
  if (preview === undefined || preview.conversationId !== conversationId) return undefined;
  set({ contextLoading: true, errorMessage: undefined });
  try {
    const result = await window.openCodeDesk.debug.attachContext({
      snapshotId: preview.id,
      expectedDigest: preview.digest,
      conversationId,
      selectedSections: [...selectedSections],
    });
    set({ contextLoading: false, contextPreview: undefined });
    return { prompt: result.prompt };
  } catch (error) {
    set({ contextLoading: false, errorMessage: readableDebugError(error) });
    return undefined;
  }
}
