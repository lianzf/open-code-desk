import { stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

import type { DebugExceptionPolicy, RunCommandSnapshot } from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DapClient } from '../dap/dap-client';

export const goInitializeArguments = {
  clientID: 'open-code-desk',
  clientName: 'OpenCode Desk',
  adapterID: 'go',
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

export function isGoDebugTarget(command: RunCommandSnapshot): boolean {
  if (command.executable.trim() === '') return false;
  if (!isGoTool(command.executable)) return true;
  const args = [...command.runtimeArgs, ...command.args];
  return args[0] === 'run' && args[1] !== undefined && !args[1].startsWith('-');
}

export async function createGoLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, unknown>>> {
  const cwd =
    command.workingDirectory === ''
      ? workspaceRoot
      : toPlatformPath(workspaceRoot, command.workingDirectory);
  const commandArguments = [...command.runtimeArgs, ...command.args];
  const goTool = isGoTool(command.executable);
  const rawProgram = goTool ? commandArguments[1] : command.executable;
  if (rawProgram === undefined) throw new Error('Go debugging requires a package or executable.');
  const program = isAbsolute(rawProgram)
    ? rawProgram
    : resolve(cwd, rawProgram.replaceAll('\\', '/'));
  const target = await stat(program).catch(() => null);
  if (target === null || (goTool ? !target.isDirectory() && !target.isFile() : !target.isFile())) {
    throw new Error(
      goTool
        ? 'Delve could not find the Go package selected by the run configuration.'
        : 'Delve exec mode requires a compiled Go executable.',
    );
  }
  return {
    type: 'go',
    request: 'launch',
    name: command.configurationName,
    mode: goTool ? 'debug' : 'exec',
    program,
    args: goTool ? commandArguments.slice(2) : commandArguments,
    cwd,
    env: environment,
    stopOnEntry: false,
  };
}

export async function setGoExceptionBreakpoints(
  client: DapClient,
  policy: DebugExceptionPolicy,
): Promise<void> {
  const filters =
    policy.exceptionPauseMode === 'none' ? [] : ['unrecovered-panic', 'runtime-fatal-throw'];
  await client.request('setExceptionBreakpoints', { filters });
}

function isGoTool(executable: string): boolean {
  return (
    basename(executable)
      .toLocaleLowerCase('en-US')
      .replace(/\.exe$/u, '') === 'go'
  );
}
