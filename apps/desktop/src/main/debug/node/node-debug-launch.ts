import { basename, isAbsolute } from 'node:path';

import type {
  DebugAdapterCapabilities,
  DebugExceptionPolicy,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DapClient } from '../dap/dap-client';
import { asRecord, booleanValue } from '../dap/dap-values';

export const initializeArguments = {
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

export function mapCapabilities(value: unknown): DebugAdapterCapabilities {
  const body = asRecord(value);
  return {
    pause: true,
    restart: booleanValue(body, 'supportsRestartRequest') ?? false,
    stepBack: booleanValue(body, 'supportsStepBack') ?? false,
    setVariable: booleanValue(body, 'supportsSetVariable') ?? false,
    conditionalBreakpoints: booleanValue(body, 'supportsConditionalBreakpoints') ?? false,
    hitConditionalBreakpoints: booleanValue(body, 'supportsHitConditionalBreakpoints') ?? false,
    logPoints: booleanValue(body, 'supportsLogPoints') ?? false,
    functionBreakpoints: booleanValue(body, 'supportsFunctionBreakpoints') ?? false,
    dataBreakpoints: booleanValue(body, 'supportsDataBreakpoints') ?? false,
    exceptionInfo: booleanValue(body, 'supportsExceptionInfoRequest') ?? false,
  };
}

export async function setNodeExceptionBreakpoints(
  client: DapClient,
  policy: DebugExceptionPolicy,
): Promise<void> {
  await client.request('setExceptionBreakpoints', createNodeExceptionBreakpointArguments(policy));
}

export function createNodeExceptionBreakpointArguments(
  policy: DebugExceptionPolicy,
): Readonly<Record<string, unknown>> {
  const included = normalizeExceptionTypes(policy.exceptionBreakTypes);
  const ignored = normalizeExceptionTypes(policy.exceptionIgnoreTypes);
  if (included.length === 0 && ignored.length === 0) {
    return {
      filters: policy.exceptionPauseMode === 'none' ? [] : [policy.exceptionPauseMode],
    };
  }
  const filterOptions: Array<{
    readonly filterId: 'all' | 'uncaught';
    readonly condition: string;
  }> = [];
  const ignoreCondition = ignored
    .map((name) => `error.name != ${JSON.stringify(name)}`)
    .join(' && ');
  if (policy.exceptionPauseMode !== 'none') {
    filterOptions.push({
      filterId: policy.exceptionPauseMode,
      condition: ignoreCondition === '' ? 'true' : ignoreCondition,
    });
  }
  if (policy.exceptionPauseMode !== 'all' && included.length > 0) {
    const includeCondition = included
      .map((name) => `error.name == ${JSON.stringify(name)}`)
      .join(' || ');
    filterOptions.push({
      filterId: 'all',
      condition:
        ignoreCondition === ''
          ? `(${includeCondition})`
          : `(${includeCondition}) && (${ignoreCondition})`,
    });
  }
  return { filters: [], filterOptions };
}

function normalizeExceptionTypes(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

export function createLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  const executableName = basename(command.executable)
    .toLocaleLowerCase('en-US')
    .replace(/\.exe$/u, '');
  const allArgs = [...command.runtimeArgs, ...command.args];
  const program =
    executableName === 'node' ? allArgs.find((value) => !value.startsWith('-')) : undefined;
  const programIndex = program === undefined ? -1 : allArgs.indexOf(program);
  return {
    type: 'pwa-node',
    request: 'launch',
    name: command.configurationName,
    cwd:
      command.workingDirectory === ''
        ? workspaceRoot
        : toPlatformPath(workspaceRoot, command.workingDirectory),
    runtimeExecutable: command.executable,
    ...(program === undefined
      ? { runtimeArgs: allArgs }
      : {
          runtimeArgs: allArgs.slice(0, programIndex),
          program: isAbsolute(program)
            ? program
            : toPlatformPath(workspaceRoot, program.replaceAll('\\', '/')),
          args: allArgs.slice(programIndex + 1),
        }),
    console: 'internalConsole',
    outputCapture: 'std',
    autoAttachChildProcesses: true,
    stopOnEntry: true,
    env: environment,
    skipFiles: ['<node_internals>/**'],
    resolveSourceMapLocations: [`${workspaceRoot.replaceAll('\\', '/')}/**`, '!**/node_modules/**'],
  };
}

export function createAttachArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
): Readonly<Record<string, unknown>> {
  const target = command.debugAttach;
  if (target === undefined || target.adapter !== 'pwa-node') {
    throw new Error('Node.js 附加调试缺少远程或容器目标。');
  }
  return {
    type: 'pwa-node',
    request: 'attach',
    name: command.configurationName,
    address: target.host,
    port: target.port,
    localRoot: workspaceRoot,
    ...(target.remoteRoot === undefined ? {} : { remoteRoot: target.remoteRoot }),
    sourceMaps: true,
    timeout: 30_000,
    restart: false,
    continueOnAttach: true,
    skipFiles: ['<node_internals>/**'],
    resolveSourceMapLocations: [`${workspaceRoot.replaceAll('\\', '/')}/**`, '!**/node_modules/**'],
  };
}
