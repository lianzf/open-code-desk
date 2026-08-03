import { isAbsolute } from 'node:path';

import type {
  DebugAdapterCapabilities,
  DebugExceptionPolicy,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DapClient } from '../dap/dap-client';
import { asRecord, booleanValue } from '../dap/dap-values';

export const pythonInitializeArguments = {
  clientID: 'open-code-desk',
  clientName: 'OpenCode Desk',
  adapterID: 'debugpy',
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

export interface PythonLaunchTarget {
  readonly pythonArgs: ReadonlyArray<string>;
  readonly args: ReadonlyArray<string>;
  readonly program?: string;
  readonly module?: string;
}

export function parsePythonLaunchTarget(command: RunCommandSnapshot): PythonLaunchTarget {
  const runtimeArgs = [...command.runtimeArgs];
  const moduleIndex = runtimeArgs.indexOf('-m');
  if (runtimeArgs.includes('-c')) {
    throw new Error('Python 调试暂不支持 -c 内联代码，请改用工作区内脚本文件。');
  }
  if (moduleIndex >= 0) {
    const module = runtimeArgs[moduleIndex + 1];
    if (module === undefined || module.trim() === '') {
      throw new Error('Python -m 参数后缺少模块名称。');
    }
    return {
      pythonArgs: runtimeArgs.slice(0, moduleIndex),
      module,
      args: [...runtimeArgs.slice(moduleIndex + 2), ...command.args],
    };
  }
  if (command.args[0] === '-m') {
    const module = command.args[1];
    if (module === undefined || module.trim() === '') {
      throw new Error('Python -m 参数后缺少模块名称。');
    }
    return { pythonArgs: runtimeArgs, module, args: command.args.slice(2) };
  }
  const program = command.args[0];
  if (program === undefined || program.trim() === '') {
    throw new Error('Python 调试配置缺少脚本文件；请在程序参数第一行填写入口文件。');
  }
  if (program.startsWith('-')) {
    throw new Error(`无法识别 Python 调试入口 ${program}；脚本入口不能是选项。`);
  }
  return { pythonArgs: runtimeArgs, program, args: command.args.slice(1) };
}

export function createPythonLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  const target = parsePythonLaunchTarget(command);
  const cwd =
    command.workingDirectory === ''
      ? workspaceRoot
      : toPlatformPath(workspaceRoot, command.workingDirectory);
  return {
    type: 'debugpy',
    request: 'launch',
    name: command.configurationName,
    cwd,
    python: [command.executable],
    pythonArgs: target.pythonArgs,
    ...(target.program === undefined
      ? { module: target.module }
      : {
          program: isAbsolute(target.program)
            ? target.program
            : toPlatformPath(workspaceRoot, target.program.replaceAll('\\', '/')),
        }),
    args: target.args,
    console: 'internalConsole',
    redirectOutput: true,
    justMyCode: true,
    stopOnEntry: false,
    subProcess: false,
    showReturnValue: true,
    env: environment,
  };
}

export function mapPythonCapabilities(value: unknown): DebugAdapterCapabilities {
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

export async function setPythonExceptionBreakpoints(
  client: DapClient,
  policy: DebugExceptionPolicy,
): Promise<void> {
  await client.request('setExceptionBreakpoints', createPythonExceptionBreakpointArguments(policy));
}

export function createPythonExceptionBreakpointArguments(
  policy: DebugExceptionPolicy,
): Readonly<Record<string, unknown>> {
  const included = normalizeExceptionTypes(policy.exceptionBreakTypes);
  const ignored = normalizeExceptionTypes(policy.exceptionIgnoreTypes);
  if (included.length === 0 && ignored.length === 0) {
    return {
      filters:
        policy.exceptionPauseMode === 'none'
          ? []
          : [policy.exceptionPauseMode === 'all' ? 'raised' : 'uncaught'],
    };
  }
  const exceptionOptions: Array<Readonly<Record<string, unknown>>> = [];
  if (policy.exceptionPauseMode !== 'none') {
    exceptionOptions.push(
      pythonExceptionOption(
        ['BaseException'],
        policy.exceptionPauseMode === 'all' ? 'always' : 'unhandled',
      ),
    );
  }
  if (policy.exceptionPauseMode !== 'all' && included.length > 0) {
    exceptionOptions.push(pythonExceptionOption(included, 'always'));
  }
  return { filters: [], exceptionOptions };
}

function pythonExceptionOption(
  names: ReadonlyArray<string>,
  breakMode: 'always' | 'unhandled',
): Readonly<Record<string, unknown>> {
  return {
    path: [{ names: ['Python Exceptions'] }, { names }],
    breakMode,
  };
}

function normalizeExceptionTypes(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}
