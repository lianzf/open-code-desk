import type { DebugSettings } from '@open-code-desk/ipc-contracts';

import {
  mergeDebugBreakpoint,
  readableDebugError,
  type DebugStoreGet,
  type DebugStoreSet,
} from './debug-store.helpers';
import type {
  DebugBreakpointDefinition,
  DebugSpecialBreakpointDefinition,
} from './debug-store.types';

export async function toggleDebugBreakpoint(
  get: DebugStoreGet,
  set: DebugStoreSet,
  relativePath: string,
  line: number,
): Promise<void> {
  const workspaceId = get().workspaceId;
  if (workspaceId === undefined) return;
  const existing = get().breakpoints.find(
    (breakpoint) => breakpoint.relativePath === relativePath && breakpoint.line === line,
  );
  try {
    if (existing === undefined) {
      const saved = await window.openCodeDesk.debug.saveBreakpoint({
        workspaceId,
        kind: 'line',
        relativePath,
        line,
        enabled: true,
      });
      set((state) => ({ breakpoints: mergeDebugBreakpoint(state.breakpoints, saved) }));
      return;
    }
    await window.openCodeDesk.debug.deleteBreakpoint({
      workspaceId,
      breakpointId: existing.id,
    });
    set((state) => ({
      breakpoints: state.breakpoints.filter((item) => item.id !== existing.id),
    }));
  } catch (error) {
    set({ errorMessage: readableDebugError(error) });
  }
}

export async function saveDebugBreakpointDefinition(
  get: DebugStoreGet,
  set: DebugStoreSet,
  input: DebugBreakpointDefinition,
): Promise<void> {
  const workspaceId = get().workspaceId;
  if (workspaceId === undefined) return;
  const existing = findBreakpoint(get, input.relativePath, input.line, input.column);
  const condition = trimmed(input.condition);
  const hitCondition = trimmed(input.hitCondition);
  const logMessage = trimmed(input.logMessage);
  try {
    const saved = await window.openCodeDesk.debug.saveBreakpoint({
      ...(existing === undefined ? {} : { id: existing.id }),
      workspaceId,
      kind: 'line',
      relativePath: input.relativePath,
      line: input.line,
      ...(input.column === undefined ? {} : { column: input.column }),
      enabled: existing?.enabled ?? true,
      ...(condition === undefined ? {} : { condition }),
      ...(hitCondition === undefined ? {} : { hitCondition }),
      ...(logMessage === undefined ? {} : { logMessage }),
    });
    set((state) => ({
      breakpoints: mergeDebugBreakpoint(state.breakpoints, saved),
      breakpointEditor: undefined,
      errorMessage: undefined,
    }));
  } catch (error) {
    set({ errorMessage: readableDebugError(error) });
  }
}

export async function setDebugBreakpointEnabled(
  get: DebugStoreGet,
  set: DebugStoreSet,
  breakpointId: string,
  enabled: boolean,
): Promise<void> {
  const workspaceId = get().workspaceId;
  const existing = get().breakpoints.find((breakpoint) => breakpoint.id === breakpointId);
  if (workspaceId === undefined || existing === undefined) return;
  try {
    const saved = await window.openCodeDesk.debug.saveBreakpoint({
      id: existing.id,
      workspaceId,
      kind: existing.kind,
      ...(existing.kind === 'line'
        ? {
            relativePath: existing.relativePath,
            line: existing.line,
            ...(existing.column === undefined ? {} : { column: existing.column }),
          }
        : existing.kind === 'function'
          ? { functionName: existing.functionName! }
          : {
              dataId: existing.dataId!,
              dataAccessType: existing.dataAccessType ?? 'write',
            }),
      enabled,
      ...(existing.condition === undefined ? {} : { condition: existing.condition }),
      ...(existing.hitCondition === undefined ? {} : { hitCondition: existing.hitCondition }),
      ...(existing.logMessage === undefined ? {} : { logMessage: existing.logMessage }),
    });
    set((state) => ({ breakpoints: mergeDebugBreakpoint(state.breakpoints, saved) }));
  } catch (error) {
    set({ errorMessage: readableDebugError(error) });
  }
}

export async function saveDebugSpecialBreakpoint(
  get: DebugStoreGet,
  set: DebugStoreSet,
  input: DebugSpecialBreakpointDefinition,
): Promise<void> {
  const workspaceId = get().workspaceId;
  if (workspaceId === undefined) return;
  try {
    const saved = await window.openCodeDesk.debug.saveBreakpoint({
      ...(input.id === undefined ? {} : { id: input.id }),
      workspaceId,
      kind: input.kind,
      enabled: true,
      ...(input.kind === 'function'
        ? { functionName: input.functionName.trim() }
        : { dataId: input.dataId.trim(), dataAccessType: input.dataAccessType }),
      ...(trimmed(input.condition) === undefined ? {} : { condition: trimmed(input.condition) }),
      ...(trimmed(input.hitCondition) === undefined
        ? {}
        : { hitCondition: trimmed(input.hitCondition) }),
    });
    set((state) => ({
      breakpoints: mergeDebugBreakpoint(state.breakpoints, saved),
      errorMessage: undefined,
    }));
  } catch (error) {
    set({ errorMessage: readableDebugError(error) });
    throw error;
  }
}

export async function saveDebugExceptionPauseMode(
  get: DebugStoreGet,
  set: DebugStoreSet,
  exceptionPauseMode: DebugSettings['exceptionPauseMode'],
): Promise<void> {
  const workspaceId = get().workspaceId;
  if (workspaceId === undefined) return;
  const current = get().settings;
  await saveDebugExceptionPolicy(get, set, {
    exceptionPauseMode,
    exceptionBreakTypes: current?.exceptionBreakTypes ?? [],
    exceptionIgnoreTypes: current?.exceptionIgnoreTypes ?? [],
  });
}

export async function saveDebugExceptionPolicy(
  get: DebugStoreGet,
  set: DebugStoreSet,
  policy: {
    readonly exceptionPauseMode: DebugSettings['exceptionPauseMode'];
    readonly exceptionBreakTypes: ReadonlyArray<string>;
    readonly exceptionIgnoreTypes: ReadonlyArray<string>;
  },
): Promise<void> {
  const workspaceId = get().workspaceId;
  if (workspaceId === undefined) return;
  try {
    const settings = await window.openCodeDesk.debug.saveSettings({
      workspaceId,
      exceptionPauseMode: policy.exceptionPauseMode,
      exceptionBreakTypes: [...policy.exceptionBreakTypes],
      exceptionIgnoreTypes: [...policy.exceptionIgnoreTypes],
    });
    set({ settings, errorMessage: undefined });
  } catch (error) {
    set({ errorMessage: readableDebugError(error) });
  }
}

function findBreakpoint(get: DebugStoreGet, relativePath: string, line: number, column?: number) {
  return get().breakpoints.find(
    (breakpoint) =>
      breakpoint.relativePath === relativePath &&
      breakpoint.line === line &&
      (breakpoint.column ?? 1) === (column ?? 1),
  );
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === '' ? undefined : result;
}
