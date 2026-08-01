import { basename, isAbsolute } from 'node:path';

import type {
  DebugAdapterCapabilities,
  DebugVariable,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import { asRecord, booleanValue, numberValue, stringValue } from './dap-values';

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
    functionBreakpoints: booleanValue(body, 'supportsFunctionBreakpoints') ?? false,
    exceptionInfo: booleanValue(body, 'supportsExceptionInfoRequest') ?? false,
  };
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

export function mapVariable(value: unknown): ReadonlyArray<DebugVariable> {
  const variable = asRecord(value);
  const name = stringValue(variable, 'name');
  const displayValue = stringValue(variable, 'value');
  const variablesReference = numberValue(variable, 'variablesReference');
  const type = stringValue(variable, 'type');
  const evaluateName = stringValue(variable, 'evaluateName');
  return name === undefined || displayValue === undefined || variablesReference === undefined
    ? []
    : [
        {
          name,
          value: displayValue,
          variablesReference,
          ...(type === undefined ? {} : { type }),
          ...(evaluateName === undefined ? {} : { evaluateName }),
        },
      ];
}
