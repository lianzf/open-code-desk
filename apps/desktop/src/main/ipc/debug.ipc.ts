import { BrowserWindow, ipcMain } from 'electron';
import {
  debugBreakpointListSchema,
  debugBreakpointSchema,
  debugChannels,
  debugEvaluationResultSchema,
  debugEventSchema,
  debugFrameRequestSchema,
  debugMutationResponseSchema,
  debugScopeListSchema,
  debugSessionListSchema,
  debugSessionRequestSchema,
  debugSessionSchema,
  debugStackFrameListSchema,
  debugThreadListSchema,
  debugThreadRequestSchema,
  debugVariableListSchema,
  debugVariablesRequestSchema,
  debugWatchExpressionListSchema,
  debugWatchExpressionSchema,
  decideDebugStartRequestSchema,
  deleteDebugBreakpointRequestSchema,
  deleteDebugWatchRequestSchema,
  evaluateDebugRequestSchema,
  listDebugBreakpointsRequestSchema,
  listDebugHistoryRequestSchema,
  listDebugWatchesRequestSchema,
  proposeDebugStartRequestSchema,
  runToCursorRequestSchema,
  saveDebugBreakpointRequestSchema,
  saveDebugWatchRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { DebugSessionService } from '../debug/debug-session.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

let unsubscribeDebugEvents: (() => void) | null = null;

export function registerDebugIpc(
  options: TrustedRendererOptions,
  service: DebugSessionService,
): void {
  unsubscribeDebugEvents?.();
  unsubscribeDebugEvents = service.subscribe((event) => {
    const parsed = debugEventSchema.parse(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send(debugChannels.event, parsed);
    }
  });

  handle(debugChannels.proposeStart, proposeDebugStartRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.proposeStart(input)),
  );
  handle(debugChannels.decideStart, decideDebugStartRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.decideStart(input)),
  );
  handle(debugChannels.stop, debugSessionRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.stop(input.sessionId)),
  );
  handle(debugChannels.restart, debugSessionRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.restart(input.sessionId)),
  );
  handle(debugChannels.pause, debugThreadRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.pause(input.sessionId, input.threadId)),
  );
  handle(debugChannels.continue, debugThreadRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.continue(input.sessionId, input.threadId)),
  );
  handle(debugChannels.next, debugThreadRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.next(input.sessionId, input.threadId)),
  );
  handle(debugChannels.stepIn, debugThreadRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.stepIn(input.sessionId, input.threadId)),
  );
  handle(debugChannels.stepOut, debugThreadRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.stepOut(input.sessionId, input.threadId)),
  );
  handle(debugChannels.runToCursor, runToCursorRequestSchema, async (input) =>
    debugSessionSchema.parse(await service.runToCursor(input)),
  );
  handle(debugChannels.listHistory, listDebugHistoryRequestSchema, async (input) =>
    debugSessionListSchema.parse(service.listHistory(input)),
  );
  handle(debugChannels.listBreakpoints, listDebugBreakpointsRequestSchema, async (input) =>
    debugBreakpointListSchema.parse(service.listBreakpoints(input)),
  );
  handle(debugChannels.saveBreakpoint, saveDebugBreakpointRequestSchema, async (input) =>
    debugBreakpointSchema.parse(await service.saveBreakpoint(input)),
  );
  handle(debugChannels.deleteBreakpoint, deleteDebugBreakpointRequestSchema, async (input) =>
    debugMutationResponseSchema.parse({ accepted: await service.deleteBreakpoint(input) }),
  );
  handle(debugChannels.threads, debugSessionRequestSchema, async (input) =>
    debugThreadListSchema.parse(await service.threads(input.sessionId)),
  );
  handle(debugChannels.stackTrace, debugThreadRequestSchema, async (input) =>
    debugStackFrameListSchema.parse(await service.stackTrace(input.sessionId, input.threadId)),
  );
  handle(debugChannels.scopes, debugFrameRequestSchema, async (input) =>
    debugScopeListSchema.parse(await service.scopes(input.sessionId, input.frameId)),
  );
  handle(debugChannels.variables, debugVariablesRequestSchema, async (input) =>
    debugVariableListSchema.parse(
      await service.variables(input.sessionId, input.variablesReference),
    ),
  );
  handle(debugChannels.evaluate, evaluateDebugRequestSchema, async (input) =>
    debugEvaluationResultSchema.parse(await service.evaluate(input)),
  );
  handle(debugChannels.listWatches, listDebugWatchesRequestSchema, async (input) =>
    debugWatchExpressionListSchema.parse(service.listWatches(input)),
  );
  handle(debugChannels.saveWatch, saveDebugWatchRequestSchema, async (input) =>
    debugWatchExpressionSchema.parse(service.saveWatch(input)),
  );
  handle(debugChannels.deleteWatch, deleteDebugWatchRequestSchema, async (input) =>
    debugMutationResponseSchema.parse({ accepted: service.deleteWatch(input) }),
  );

  function handle<TInput, TOutput>(
    channel: string,
    schema: { parse(value: unknown): TInput },
    action: (input: TInput) => Promise<TOutput>,
  ): void {
    ipcMain.handle(channel, async (event, untrustedInput: unknown) => {
      assertTrustedIpcEvent(event, options);
      return action(schema.parse(untrustedInput));
    });
  }
}

export function unregisterDebugIpc(): void {
  unsubscribeDebugEvents?.();
  unsubscribeDebugEvents = null;
  Object.values(debugChannels)
    .filter((channel) => channel !== debugChannels.event)
    .forEach((channel) => ipcMain.removeHandler(channel));
}
