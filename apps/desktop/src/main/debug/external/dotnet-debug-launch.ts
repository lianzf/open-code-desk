import { stat } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

import type { DebugExceptionPolicy, RunCommandSnapshot } from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DapClient } from '../dap/dap-client';

const supportedTargetExtensions = new Set(['.dll', '.exe']);

export const dotnetInitializeArguments = {
  clientID: 'open-code-desk',
  clientName: 'OpenCode Desk',
  adapterID: 'coreclr',
  locale: 'en-US',
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

export function isDotnetDebugTarget(command: RunCommandSnapshot): boolean {
  return supportedTargetExtensions.has(extname(command.executable).toLocaleLowerCase('en-US'));
}

export async function createDotnetLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, unknown>>> {
  const cwd =
    command.workingDirectory === ''
      ? workspaceRoot
      : toPlatformPath(workspaceRoot, command.workingDirectory);
  const program = isAbsolute(command.executable)
    ? command.executable
    : resolve(cwd, command.executable.replaceAll('\\', '/'));
  if (!isDotnetDebugTarget(command) || (await stat(program).catch(() => null))?.isFile() !== true) {
    throw new Error(
      '.NET debugging requires a compiled .dll or .exe. Build the project and select that output as the run executable.',
    );
  }
  return {
    type: 'coreclr',
    request: 'launch',
    name: command.configurationName,
    program,
    args: [...command.runtimeArgs, ...command.args],
    cwd,
    env: environment,
    stopAtEntry: false,
    justMyCode: true,
  };
}

export async function setDotnetExceptionBreakpoints(
  client: DapClient,
  policy: DebugExceptionPolicy,
): Promise<void> {
  const filters =
    policy.exceptionPauseMode === 'none'
      ? []
      : policy.exceptionPauseMode === 'all'
        ? ['all']
        : ['user-unhandled'];
  await client.request('setExceptionBreakpoints', { filters });
}
