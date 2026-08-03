import type { DebugExceptionPolicy, RunCommandSnapshot } from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DapClient } from '../dap/dap-client';
import { setNodeExceptionBreakpoints } from '../node/node-debug-launch';

export const electronMainInitializeArguments = {
  clientID: 'open-code-desk',
  clientName: 'OpenCode Desk',
  adapterID: 'pwa-node',
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

export const electronRendererInitializeArguments = {
  ...electronMainInitializeArguments,
  adapterID: 'pwa-chrome',
} as const;

export function createElectronMainLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  if (command.port === undefined) {
    throw new Error('Electron 调试配置缺少渲染进程调试端口。');
  }
  const cwd =
    command.workingDirectory === ''
      ? workspaceRoot
      : toPlatformPath(workspaceRoot, command.workingDirectory);
  return {
    type: 'pwa-node',
    request: 'launch',
    name: `${command.configurationName} · Main`,
    cwd,
    runtimeExecutable: command.executable,
    runtimeArgs: [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${command.port}`,
      ...command.runtimeArgs,
      ...command.args,
    ],
    console: 'internalConsole',
    outputCapture: 'std',
    autoAttachChildProcesses: false,
    stopOnEntry: false,
    env: environment,
    skipFiles: ['<node_internals>/**'],
    resolveSourceMapLocations: [`${workspaceRoot.replaceAll('\\', '/')}/**`, '!**/node_modules/**'],
  };
}

export function createElectronRendererAttachArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
): Readonly<Record<string, unknown>> {
  if (command.port === undefined) {
    throw new Error('Electron 调试配置缺少渲染进程调试端口。');
  }
  return {
    type: 'pwa-chrome',
    request: 'attach',
    name: `${command.configurationName} · Renderer`,
    address: '127.0.0.1',
    port: command.port,
    webRoot: workspaceRoot,
    urlFilter: '*',
    targetSelection: 'automatic',
    restart: true,
    sourceMaps: true,
    smartStep: true,
    timeout: 30_000,
    resolveSourceMapLocations: [`${workspaceRoot.replaceAll('\\', '/')}/**`, '!**/node_modules/**'],
  };
}

export function setElectronExceptionBreakpoints(
  client: DapClient,
  policy: DebugExceptionPolicy,
): Promise<void> {
  return setNodeExceptionBreakpoints(client, policy);
}
