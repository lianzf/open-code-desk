import type { DebugExceptionPolicy, RunCommandSnapshot } from '@open-code-desk/domain';

import type { DapClient } from '../dap/dap-client';
import { setNodeExceptionBreakpoints } from '../node/node-debug-launch';

export type BrowserDebugAdapterType = 'pwa-chrome' | 'pwa-msedge';

export function browserInitializeArguments(adapterID: BrowserDebugAdapterType) {
  return {
    clientID: 'open-code-desk',
    clientName: 'OpenCode Desk',
    adapterID,
    locale: 'zh-CN',
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: 'path',
    supportsVariableType: true,
    supportsVariablePaging: true,
    supportsRunInTerminalRequest: false,
    supportsProgressReporting: true,
    supportsInvalidatedEvent: true,
    supportsMemoryReferences: false,
  } as const;
}

export function createBrowserLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  browserExecutable: string,
  adapterType: BrowserDebugAdapterType,
  browserArguments: ReadonlyArray<string> = [],
): Readonly<Record<string, unknown>> {
  if (command.port === undefined) {
    throw new Error('Browser debugging requires a development server port.');
  }
  return {
    type: adapterType,
    request: 'launch',
    name: command.configurationName,
    url: `http://127.0.0.1:${command.port}`,
    webRoot: workspaceRoot,
    runtimeExecutable: browserExecutable,
    ...(browserArguments.length === 0 ? {} : { runtimeArgs: [...browserArguments] }),
    cleanUp: 'wholeBrowser',
    sourceMaps: true,
    smartStep: true,
    timeout: 30_000,
    resolveSourceMapLocations: [`${workspaceRoot.replaceAll('\\', '/')}/**`, '!**/node_modules/**'],
  };
}

export function setBrowserExceptionBreakpoints(
  client: DapClient,
  policy: DebugExceptionPolicy,
): Promise<void> {
  return setNodeExceptionBreakpoints(client, policy);
}
