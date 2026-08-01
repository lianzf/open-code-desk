import { create } from 'zustand';

import {
  createDebugConsoleEntry,
  deleteBreakpointGroup,
  isActiveDebugStatus,
  loadDebugScopes,
  loadDebugStack,
  mergeDebugBreakpoint,
  mergeDebugSession,
  readableDebugError,
  refreshDebugWatches,
  refreshPausedDebugState,
  runDebugSessionAction,
  selectedDebugSession,
} from './debug-store.helpers';
import type { DebugState } from './debug-store.types';

export { mergeDebugBreakpoint, mergeDebugSession } from './debug-store.helpers';
export type { DebugConsoleEntry } from './debug-store.types';

let unsubscribeDebugEvents: (() => void) | undefined;

export const useDebugStore = create<DebugState>((set, get) => ({
  workspaceId: undefined,
  initialized: false,
  loading: false,
  sessions: [],
  selectedSessionId: undefined,
  breakpoints: [],
  watches: [],
  threads: [],
  selectedThreadId: undefined,
  stackFrames: [],
  selectedFrameId: undefined,
  scopes: [],
  variables: {},
  watchResults: {},
  consoleEntries: [],
  contextPreview: undefined,
  contextLoading: false,
  errorMessage: undefined,

  async initialize(workspaceId) {
    if (get().workspaceId === workspaceId && get().initialized) return;
    unsubscribeDebugEvents?.();
    unsubscribeDebugEvents = window.openCodeDesk.debug.onEvent((event) => get().notify(event));
    set({
      workspaceId,
      initialized: false,
      loading: true,
      sessions: [],
      selectedSessionId: undefined,
      breakpoints: [],
      watches: [],
      threads: [],
      selectedThreadId: undefined,
      stackFrames: [],
      selectedFrameId: undefined,
      scopes: [],
      variables: {},
      watchResults: {},
      consoleEntries: [],
      contextPreview: undefined,
      contextLoading: false,
      errorMessage: undefined,
    });
    try {
      const [sessions, breakpoints, watches] = await Promise.all([
        window.openCodeDesk.debug.listHistory({ workspaceId, limit: 100 }),
        window.openCodeDesk.debug.listBreakpoints({ workspaceId }),
        window.openCodeDesk.debug.listWatches({ workspaceId }),
      ]);
      if (get().workspaceId !== workspaceId) return;
      const active = sessions.find((session) => isActiveDebugStatus(session.status));
      set({
        sessions,
        selectedSessionId: active?.id ?? sessions[0]?.id,
        breakpoints,
        watches,
        initialized: true,
        loading: false,
      });
      if (active?.status === 'paused') await refreshPausedDebugState(get, set, active);
    } catch (error) {
      set({ initialized: true, loading: false, errorMessage: readableDebugError(error) });
    }
  },

  dispose() {
    unsubscribeDebugEvents?.();
    unsubscribeDebugEvents = undefined;
    set({ initialized: false, workspaceId: undefined });
  },

  async proposeStart(configurationId) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) return undefined;
    set({ loading: true, errorMessage: undefined });
    try {
      const session = await window.openCodeDesk.debug.proposeStart({
        workspaceId,
        configurationId,
      });
      set((state) => ({
        sessions: mergeDebugSession(state.sessions, session),
        selectedSessionId: session.id,
        loading: false,
      }));
      return session;
    } catch (error) {
      set({ loading: false, errorMessage: readableDebugError(error) });
      return undefined;
    }
  },

  async decideStart(sessionId, decision) {
    const session = get().sessions.find((item) => item.id === sessionId);
    if (session?.status !== 'pending_approval') return;
    set({ loading: true, errorMessage: undefined });
    try {
      const updated = await window.openCodeDesk.debug.decideStart({
        sessionId,
        expectedApprovalDigest: session.approvalDigest,
        decision,
      });
      set((state) => ({ sessions: mergeDebugSession(state.sessions, updated), loading: false }));
    } catch (error) {
      set({ loading: false, errorMessage: readableDebugError(error) });
    }
  },

  async stop(sessionId) {
    const targetId = sessionId ?? get().selectedSessionId;
    if (targetId === undefined) return;
    await runDebugSessionAction(set, () => window.openCodeDesk.debug.stop({ sessionId: targetId }));
  },

  async restart(sessionId) {
    const targetId = sessionId ?? get().selectedSessionId;
    if (targetId === undefined) return;
    await runDebugSessionAction(set, () =>
      window.openCodeDesk.debug.restart({ sessionId: targetId }),
    );
  },

  async control(action) {
    const session = selectedDebugSession(get());
    const threadId = get().selectedThreadId ?? session?.pause?.threadId;
    if (session === undefined || threadId === undefined) return;
    const api = window.openCodeDesk.debug;
    await runDebugSessionAction(set, () => api[action]({ sessionId: session.id, threadId }));
  },

  async runToCursor(relativePath, line, column) {
    const session = selectedDebugSession(get());
    if (session === undefined) return;
    await runDebugSessionAction(set, () =>
      window.openCodeDesk.debug.runToCursor({
        sessionId: session.id,
        relativePath,
        line,
        ...(column === undefined ? {} : { column }),
      }),
    );
  },

  async toggleBreakpoint(relativePath, line) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) return;
    const existing = get().breakpoints.find(
      (breakpoint) => breakpoint.relativePath === relativePath && breakpoint.line === line,
    );
    try {
      if (existing === undefined) {
        const saved = await window.openCodeDesk.debug.saveBreakpoint({
          workspaceId,
          relativePath,
          line,
          enabled: true,
        });
        set((state) => ({ breakpoints: mergeDebugBreakpoint(state.breakpoints, saved) }));
      } else {
        await window.openCodeDesk.debug.deleteBreakpoint({
          workspaceId,
          breakpointId: existing.id,
        });
        set((state) => ({
          breakpoints: state.breakpoints.filter((item) => item.id !== existing.id),
        }));
      }
    } catch (error) {
      set({ errorMessage: readableDebugError(error) });
    }
  },

  async setBreakpointEnabled(breakpointId, enabled) {
    const workspaceId = get().workspaceId;
    const existing = get().breakpoints.find((breakpoint) => breakpoint.id === breakpointId);
    if (workspaceId === undefined || existing === undefined) return;
    try {
      const saved = await window.openCodeDesk.debug.saveBreakpoint({
        id: existing.id,
        workspaceId,
        relativePath: existing.relativePath,
        line: existing.line,
        ...(existing.column === undefined ? {} : { column: existing.column }),
        enabled,
      });
      set((state) => ({ breakpoints: mergeDebugBreakpoint(state.breakpoints, saved) }));
    } catch (error) {
      set({ errorMessage: readableDebugError(error) });
    }
  },

  async deleteBreakpoint(breakpointId) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) return;
    try {
      await window.openCodeDesk.debug.deleteBreakpoint({ workspaceId, breakpointId });
      set((state) => ({
        breakpoints: state.breakpoints.filter((breakpoint) => breakpoint.id !== breakpointId),
      }));
    } catch (error) {
      set({ errorMessage: readableDebugError(error) });
    }
  },

  async deleteBreakpointsForFile(relativePath) {
    await deleteBreakpointGroup(get, set, (breakpoint) => breakpoint.relativePath === relativePath);
  },

  async deleteAllBreakpoints() {
    await deleteBreakpointGroup(get, set, () => true);
  },

  async selectThread(threadId) {
    const session = selectedDebugSession(get());
    if (session === undefined) return;
    set({ selectedThreadId: threadId });
    await loadDebugStack(get, set, session, threadId);
  },

  async selectFrame(frameId) {
    const session = selectedDebugSession(get());
    if (session === undefined) return;
    set({ selectedFrameId: frameId, scopes: [], variables: {} });
    await loadDebugScopes(get, set, session, frameId);
    await refreshDebugWatches(get, set, session.id, frameId);
  },

  async expandVariables(reference) {
    const session = selectedDebugSession(get());
    if (session === undefined || reference === 0 || get().variables[reference] !== undefined)
      return;
    try {
      const variables = await window.openCodeDesk.debug.variables({
        sessionId: session.id,
        variablesReference: reference,
      });
      set((state) => ({ variables: { ...state.variables, [reference]: variables } }));
    } catch (error) {
      set({ errorMessage: readableDebugError(error) });
    }
  },

  async addWatch(expression) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined || expression.trim() === '') return;
    try {
      const watch = await window.openCodeDesk.debug.saveWatch({ workspaceId, expression });
      set((state) => ({
        watches: [...state.watches.filter((item) => item.id !== watch.id), watch],
      }));
      const session = selectedDebugSession(get());
      if (session?.status === 'paused') {
        await refreshDebugWatches(get, set, session.id, get().selectedFrameId);
      }
    } catch (error) {
      set({ errorMessage: readableDebugError(error) });
    }
  },

  async deleteWatch(watchId) {
    const workspaceId = get().workspaceId;
    if (workspaceId === undefined) return;
    await window.openCodeDesk.debug.deleteWatch({ workspaceId, watchId });
    set((state) => ({ watches: state.watches.filter((item) => item.id !== watchId) }));
  },

  async evaluate(expression, context = 'repl') {
    const session = selectedDebugSession(get());
    if (session === undefined || expression.trim() === '') return undefined;
    set((state) => ({
      consoleEntries: [
        ...state.consoleEntries,
        createDebugConsoleEntry('input', `> ${expression}`),
      ],
    }));
    try {
      const result = await window.openCodeDesk.debug.evaluate({
        sessionId: session.id,
        expression,
        context,
        ...(get().selectedFrameId === undefined ? {} : { frameId: get().selectedFrameId }),
      });
      set((state) => ({
        consoleEntries: [
          ...state.consoleEntries,
          createDebugConsoleEntry('result', result.result),
        ].slice(-2_000),
      }));
      return result;
    } catch (error) {
      set({ errorMessage: readableDebugError(error) });
      return undefined;
    }
  },

  clearConsole() {
    set({ consoleEntries: [] });
  },

  async previewContext(conversationId) {
    const session = selectedDebugSession(get());
    if (session?.status !== 'paused') return undefined;
    set({ contextLoading: true, contextPreview: undefined, errorMessage: undefined });
    try {
      const snapshot = await window.openCodeDesk.debug.previewContext({
        sessionId: session.id,
        conversationId,
      });
      set({ contextLoading: false, contextPreview: snapshot });
      return snapshot;
    } catch (error) {
      set({ contextLoading: false, errorMessage: readableDebugError(error) });
      return undefined;
    }
  },

  async attachContext(conversationId, selectedSections) {
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
  },

  clearContextPreview() {
    set({ contextPreview: undefined });
  },

  notify(event) {
    if (event.type !== 'status' && event.workspaceId !== get().workspaceId) return;
    if (event.type === 'breakpoints') {
      set({ breakpoints: event.breakpoints });
    } else if (event.type === 'output') {
      set((state) => ({
        consoleEntries: [
          ...state.consoleEntries,
          {
            id: `${event.sessionId}:${event.sequence}`,
            category: event.category,
            data: event.data,
          },
        ].slice(-2_000),
      }));
    } else if (event.session.workspaceId === get().workspaceId) {
      const sessions = mergeDebugSession(get().sessions, event.session);
      const latest = sessions.find((session) => session.id === event.session.id);
      set((state) => ({
        sessions,
        selectedSessionId:
          latest !== undefined && isActiveDebugStatus(latest.status)
            ? latest.id
            : state.selectedSessionId,
      }));
      if (latest?.updatedAt !== event.session.updatedAt || latest.status !== event.session.status) {
        return;
      }
      if (event.session.status === 'paused') {
        void refreshPausedDebugState(get, set, event.session);
      }
      if (event.session.status === 'starting') {
        set({ consoleEntries: [], contextPreview: undefined });
      }
      if (['running', 'completed', 'stopped', 'failed'].includes(event.session.status)) {
        set({
          threads: [],
          stackFrames: [],
          scopes: [],
          variables: {},
          selectedThreadId: undefined,
          selectedFrameId: undefined,
          contextPreview: undefined,
        });
      }
    }
  },
}));
