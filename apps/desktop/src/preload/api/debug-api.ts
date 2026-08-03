import { ipcRenderer } from 'electron';

import {
  attachDebugContextRequestSchema,
  attachDebugContextResponseSchema,
  debugBreakpointListSchema,
  debugBreakpointSchema,
  debugChannels,
  debugContextChannels,
  debugContextSnapshotSchema,
  debugEvaluationResultSchema,
  debugEventSchema,
  debugFrameRequestSchema,
  debugMutationResponseSchema,
  debugScopeListSchema,
  debugSessionListSchema,
  debugSessionRequestSchema,
  debugSessionSchema,
  debugSettingsSchema,
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
  getDebugSettingsRequestSchema,
  listDebugBreakpointsRequestSchema,
  listDebugHistoryRequestSchema,
  listDebugWatchesRequestSchema,
  previewDebugContextRequestSchema,
  proposeDebugStartRequestSchema,
  runToCursorRequestSchema,
  saveDebugBreakpointRequestSchema,
  saveDebugSettingsRequestSchema,
  saveDebugWatchRequestSchema,
  type DesktopApi,
} from '@open-code-desk/ipc-contracts';

export const debugApi: DesktopApi['debug'] = {
  async proposeStart(input) {
    const request = proposeDebugStartRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.proposeStart, request));
  },
  async decideStart(input) {
    const request = decideDebugStartRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.decideStart, request));
  },
  async stop(input) {
    const request = debugSessionRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.stop, request));
  },
  async restart(input) {
    const request = debugSessionRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.restart, request));
  },
  async pause(input) {
    const request = debugThreadRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.pause, request));
  },
  async continue(input) {
    const request = debugThreadRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.continue, request));
  },
  async next(input) {
    const request = debugThreadRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.next, request));
  },
  async stepIn(input) {
    const request = debugThreadRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.stepIn, request));
  },
  async stepOut(input) {
    const request = debugThreadRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.stepOut, request));
  },
  async runToCursor(input) {
    const request = runToCursorRequestSchema.parse(input);
    return debugSessionSchema.parse(await ipcRenderer.invoke(debugChannels.runToCursor, request));
  },
  async listHistory(input) {
    const request = listDebugHistoryRequestSchema.parse(input);
    return debugSessionListSchema.parse(
      await ipcRenderer.invoke(debugChannels.listHistory, request),
    );
  },
  async listBreakpoints(input) {
    const request = listDebugBreakpointsRequestSchema.parse(input);
    return debugBreakpointListSchema.parse(
      await ipcRenderer.invoke(debugChannels.listBreakpoints, request),
    );
  },
  async saveBreakpoint(input) {
    const request = saveDebugBreakpointRequestSchema.parse(input);
    return debugBreakpointSchema.parse(
      await ipcRenderer.invoke(debugChannels.saveBreakpoint, request),
    );
  },
  async deleteBreakpoint(input) {
    const request = deleteDebugBreakpointRequestSchema.parse(input);
    return debugMutationResponseSchema.parse(
      await ipcRenderer.invoke(debugChannels.deleteBreakpoint, request),
    );
  },
  async getSettings(input) {
    const request = getDebugSettingsRequestSchema.parse(input);
    return debugSettingsSchema.parse(await ipcRenderer.invoke(debugChannels.getSettings, request));
  },
  async saveSettings(input) {
    const request = saveDebugSettingsRequestSchema.parse(input);
    return debugSettingsSchema.parse(await ipcRenderer.invoke(debugChannels.saveSettings, request));
  },
  async threads(input) {
    const request = debugSessionRequestSchema.parse(input);
    return debugThreadListSchema.parse(await ipcRenderer.invoke(debugChannels.threads, request));
  },
  async stackTrace(input) {
    const request = debugThreadRequestSchema.parse(input);
    return debugStackFrameListSchema.parse(
      await ipcRenderer.invoke(debugChannels.stackTrace, request),
    );
  },
  async scopes(input) {
    const request = debugFrameRequestSchema.parse(input);
    return debugScopeListSchema.parse(await ipcRenderer.invoke(debugChannels.scopes, request));
  },
  async variables(input) {
    const request = debugVariablesRequestSchema.parse(input);
    return debugVariableListSchema.parse(
      await ipcRenderer.invoke(debugChannels.variables, request),
    );
  },
  async evaluate(input) {
    const request = evaluateDebugRequestSchema.parse(input);
    return debugEvaluationResultSchema.parse(
      await ipcRenderer.invoke(debugChannels.evaluate, request),
    );
  },
  async listWatches(input) {
    const request = listDebugWatchesRequestSchema.parse(input);
    return debugWatchExpressionListSchema.parse(
      await ipcRenderer.invoke(debugChannels.listWatches, request),
    );
  },
  async saveWatch(input) {
    const request = saveDebugWatchRequestSchema.parse(input);
    return debugWatchExpressionSchema.parse(
      await ipcRenderer.invoke(debugChannels.saveWatch, request),
    );
  },
  async deleteWatch(input) {
    const request = deleteDebugWatchRequestSchema.parse(input);
    return debugMutationResponseSchema.parse(
      await ipcRenderer.invoke(debugChannels.deleteWatch, request),
    );
  },
  async previewContext(input) {
    const request = previewDebugContextRequestSchema.parse(input);
    return debugContextSnapshotSchema.parse(
      await ipcRenderer.invoke(debugContextChannels.preview, request),
    );
  },
  async attachContext(input) {
    const request = attachDebugContextRequestSchema.parse(input);
    return attachDebugContextResponseSchema.parse(
      await ipcRenderer.invoke(debugContextChannels.attach, request),
    );
  },
  onEvent(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, untrustedEvent: unknown) => {
      listener(debugEventSchema.parse(untrustedEvent));
    };
    ipcRenderer.on(debugChannels.event, wrappedListener);
    return () => ipcRenderer.removeListener(debugChannels.event, wrappedListener);
  },
};
