import { stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

import type {
  DebugAdapterCapabilities,
  DebugExceptionPolicy,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DapClient } from '../dap/dap-client';
import { mapExternalDapCapabilities } from './external-debug-capabilities';

const buildToolNames = new Set(['cargo', 'cmake', 'make', 'msbuild', 'ninja']);

export const lldbInitializeArguments = {
  clientID: 'open-code-desk',
  clientName: 'OpenCode Desk',
  adapterID: 'lldb-dap',
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

export function isLldbDebugTarget(command: RunCommandSnapshot): boolean {
  const executable = basename(command.executable)
    .toLocaleLowerCase('en-US')
    .replace(/\.exe$/u, '');
  return command.executable.trim() !== '' && !buildToolNames.has(executable);
}

export async function createLldbLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, unknown>>> {
  const cwd =
    command.workingDirectory === ''
      ? workspaceRoot
      : toPlatformPath(workspaceRoot, command.workingDirectory);
  const unresolvedProgram = command.executable.replaceAll('\\', '/');
  const program = isAbsolute(command.executable)
    ? command.executable
    : resolve(cwd, unresolvedProgram);
  if ((await stat(program).catch(() => null))?.isFile() !== true) {
    throw new Error(
      'LLDB debugging requires a compiled executable. Build the project and select its binary as the run executable.',
    );
  }
  return {
    type: 'lldb-dap',
    request: 'launch',
    name: command.configurationName,
    program,
    args: [...command.runtimeArgs, ...command.args],
    cwd,
    env: environment,
    stopOnEntry: false,
  };
}

export function mapLldbCapabilities(value: unknown): DebugAdapterCapabilities {
  return mapExternalDapCapabilities(value);
}

export async function setLldbExceptionBreakpoints(
  client: DapClient,
  policy: DebugExceptionPolicy,
): Promise<void> {
  const filters =
    policy.exceptionPauseMode === 'none' ? [] : ['cpp_throw', 'objc_throw', 'swift_throw'];
  await client.request('setExceptionBreakpoints', { filters });
}
