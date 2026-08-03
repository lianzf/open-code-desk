import type { DebugBreakpoint, DebugSession } from '@open-code-desk/ipc-contracts';

import { rendererErrorMessage } from '../settings/error-i18n';

import type { DebugConsoleEntry, DebugState } from './debug-store.types';

export type DebugStoreGet = () => DebugState;
export type DebugStoreSet = (
  update: Partial<DebugState> | ((state: DebugState) => Partial<DebugState>),
) => void;

export async function runDebugSessionAction(
  set: DebugStoreSet,
  action: () => Promise<DebugSession>,
): Promise<void> {
  set({ loading: true, errorMessage: undefined });
  try {
    const session = await action();
    set((state) => ({ sessions: mergeDebugSession(state.sessions, session), loading: false }));
  } catch (error) {
    set({ loading: false, errorMessage: readableDebugError(error) });
  }
}

export async function refreshPausedDebugState(
  get: DebugStoreGet,
  set: DebugStoreSet,
  session: DebugSession,
): Promise<void> {
  try {
    const threads = await window.openCodeDesk.debug.threads({ sessionId: session.id });
    if (!isCurrentPause(get(), session)) return;
    const threadId = session.pause?.threadId ?? threads[0]?.id;
    set({ threads, selectedThreadId: threadId });
    if (threadId !== undefined) await loadStack(get, set, session, threadId);
  } catch (error) {
    set({ errorMessage: readableDebugError(error) });
  }
}

export async function loadDebugStack(
  get: DebugStoreGet,
  set: DebugStoreSet,
  session: DebugSession,
  threadId: number,
): Promise<void> {
  await loadStack(get, set, session, threadId);
}

export async function loadDebugScopes(
  get: DebugStoreGet,
  set: DebugStoreSet,
  session: DebugSession,
  frameId: number,
): Promise<void> {
  await loadScopes(get, set, session, frameId);
}

async function loadStack(
  get: DebugStoreGet,
  set: DebugStoreSet,
  session: DebugSession,
  threadId: number,
): Promise<void> {
  const frames = await window.openCodeDesk.debug.stackTrace({ sessionId: session.id, threadId });
  if (!isCurrentPause(get(), session)) return;
  const frameId = frames[0]?.id;
  set({ stackFrames: frames, selectedFrameId: frameId, scopes: [], variables: {} });
  if (frameId !== undefined) {
    await loadScopes(get, set, session, frameId);
    if (isCurrentPause(get(), session)) {
      await refreshDebugWatches(get, set, session.id, frameId);
    }
  }
}

async function loadScopes(
  get: DebugStoreGet,
  set: DebugStoreSet,
  session: DebugSession,
  frameId: number,
): Promise<void> {
  const scopes = await window.openCodeDesk.debug.scopes({ sessionId: session.id, frameId });
  if (!isCurrentPause(get(), session)) return;
  set({ scopes });
  const entries = await Promise.all(
    scopes
      .filter((scope) => !scope.expensive)
      .map(
        async (scope) =>
          [
            scope.variablesReference,
            await window.openCodeDesk.debug.variables({
              sessionId: session.id,
              variablesReference: scope.variablesReference,
            }),
          ] as const,
      ),
  );
  if (!isCurrentPause(get(), session)) return;
  set((state) => ({ variables: { ...state.variables, ...Object.fromEntries(entries) } }));
}

export async function refreshDebugWatches(
  get: DebugStoreGet,
  set: DebugStoreSet,
  sessionId: string,
  frameId?: number,
): Promise<void> {
  const results = await Promise.all(
    get().watches.map(async (watch) => {
      try {
        return [
          watch.id,
          await window.openCodeDesk.debug.evaluate({
            sessionId,
            expression: watch.expression,
            context: 'watch',
            ...(frameId === undefined ? {} : { frameId }),
          }),
        ] as const;
      } catch (error) {
        return [watch.id, readableDebugError(error)] as const;
      }
    }),
  );
  set({ watchResults: Object.fromEntries(results) });
}

export async function deleteBreakpointGroup(
  get: DebugStoreGet,
  set: DebugStoreSet,
  predicate: (breakpoint: DebugBreakpoint) => boolean,
): Promise<void> {
  const workspaceId = get().workspaceId;
  const targets = get().breakpoints.filter(predicate);
  if (workspaceId === undefined || targets.length === 0) return;
  try {
    await Promise.all(
      targets.map((breakpoint) =>
        window.openCodeDesk.debug.deleteBreakpoint({ workspaceId, breakpointId: breakpoint.id }),
      ),
    );
    const deletedIds = new Set(targets.map((breakpoint) => breakpoint.id));
    set((state) => ({
      breakpoints: state.breakpoints.filter((breakpoint) => !deletedIds.has(breakpoint.id)),
    }));
  } catch (error) {
    set({ errorMessage: readableDebugError(error) });
  }
}

export function mergeDebugSession(
  values: ReadonlyArray<DebugSession>,
  session: DebugSession,
): ReadonlyArray<DebugSession> {
  const existing = values.find((item) => item.id === session.id);
  const accepted =
    existing !== undefined && existing.updatedAt.localeCompare(session.updatedAt) > 0
      ? existing
      : session;
  return [accepted, ...values.filter((item) => item.id !== session.id)].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function mergeDebugBreakpoint(
  values: ReadonlyArray<DebugBreakpoint>,
  breakpoint: DebugBreakpoint,
): ReadonlyArray<DebugBreakpoint> {
  const column = breakpoint.column ?? 1;
  return [
    ...values.filter(
      (item) =>
        item.id !== breakpoint.id &&
        !(
          item.workspaceId === breakpoint.workspaceId &&
          item.relativePath === breakpoint.relativePath &&
          item.line === breakpoint.line &&
          (item.column ?? 1) === column
        ),
    ),
    breakpoint,
  ].sort(
    (left, right) =>
      left.relativePath.localeCompare(right.relativePath) ||
      left.line - right.line ||
      (left.column ?? 1) - (right.column ?? 1),
  );
}

export function selectedDebugSession(state: DebugState): DebugSession | undefined {
  return state.sessions.find((session) => session.id === state.selectedSessionId);
}

export function isActiveDebugStatus(status: DebugSession['status']): boolean {
  return ['pending_approval', 'starting', 'running', 'paused', 'stopping'].includes(status);
}

export function readableDebugError(error: unknown): string {
  return rendererErrorMessage(error, 'debugOperationFailed');
}

export function createDebugConsoleEntry(
  category: DebugConsoleEntry['category'],
  data: string,
): DebugConsoleEntry {
  return { id: crypto.randomUUID(), category, data };
}

function isCurrentPause(state: DebugState, expected: DebugSession): boolean {
  const current = state.sessions.find((session) => session.id === expected.id);
  return current?.status === 'paused' && current.updatedAt === expected.updatedAt;
}
