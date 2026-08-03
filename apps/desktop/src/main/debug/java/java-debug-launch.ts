import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  DebugAdapterCapabilities,
  DebugExceptionPolicy,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DapClient } from '../dap/dap-client';
import { asRecord, stringValue } from '../dap/dap-values';
import { mapExternalDapCapabilities } from '../external/external-debug-capabilities';
import type {
  JavaClasspaths,
  JavaDebugAdapterProcess,
  JavaMainClass,
} from './java-debug-adapter-process';

export const javaInitializeArguments = {
  clientID: 'open-code-desk',
  clientName: 'OpenCode Desk',
  adapterID: 'java',
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

const javaExecutables = new Set(['java', 'javaw']);

export function isDirectJavaLaunch(command: RunCommandSnapshot): boolean {
  return javaExecutables.has(
    basename(command.executable)
      .toLocaleLowerCase('en-US')
      .replace(/\.exe$/u, ''),
  );
}

export function parseDirectJavaMainClass(command: RunCommandSnapshot): JavaMainClass | undefined {
  if (!isDirectJavaLaunch(command)) return undefined;
  const mainClass = command.args[0];
  if (mainClass === undefined || mainClass.trim() === '' || mainClass.startsWith('-')) {
    throw new Error('Java debug configuration must put the fully qualified main class first.');
  }
  if (mainClass.endsWith('.jar')) {
    throw new Error('Java -jar debugging is not supported yet; select a project main class.');
  }
  return { mainClass };
}

export async function resolveJavaMainClass(
  process: JavaDebugAdapterProcess,
  command: RunCommandSnapshot,
  workspaceRoot: string,
): Promise<JavaMainClass> {
  const direct = parseDirectJavaMainClass(command);
  if (direct !== undefined) return direct;
  const candidates = await process.resolveMainClasses(pathToFileURL(workspaceRoot).href);
  if (candidates.length === 0) {
    throw new Error(
      'No Java main class was found. Wait for project import to finish and ensure the project has public static void main(String[] args).',
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple Java main classes were found (${candidates.map((item) => item.mainClass).join(', ')}). Create a direct Java run configuration with the desired class first in program arguments.`,
    );
  }
  return candidates[0] as JavaMainClass;
}

export function createJavaLaunchArguments(
  command: RunCommandSnapshot,
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
  target: JavaMainClass,
  classpaths: JavaClasspaths,
): Readonly<Record<string, unknown>> {
  const cwd =
    command.workingDirectory === ''
      ? workspaceRoot
      : toPlatformPath(workspaceRoot, command.workingDirectory);
  return {
    type: 'java',
    request: 'launch',
    name: command.configurationName,
    mainClass: target.mainClass,
    ...(target.projectName === undefined ? {} : { projectName: target.projectName }),
    args: formatJavaArguments(isDirectJavaLaunch(command) ? command.args.slice(1) : []),
    vmArgs: formatJavaArguments(isDirectJavaLaunch(command) ? command.runtimeArgs : []),
    classPaths: classpaths.classPaths,
    modulePaths: classpaths.modulePaths,
    cwd,
    env: environment,
    console: 'internalConsole',
    stopOnEntry: false,
    shortenCommandLine: 'argfile',
    ...(isDirectJavaLaunch(command) ? { javaExec: command.executable } : {}),
  };
}

function formatJavaArguments(values: ReadonlyArray<string>): string {
  return values.map((value) => JSON.stringify(value)).join(' ');
}

export function mapJavaCapabilities(value: unknown): DebugAdapterCapabilities {
  return mapExternalDapCapabilities(value);
}

export interface JavaExceptionPolicyState {
  current: DebugExceptionPolicy;
}

export async function applyJavaExceptionPolicy(
  process: JavaDebugAdapterProcess,
  client: DapClient,
  state: JavaExceptionPolicyState,
  policy: DebugExceptionPolicy,
): Promise<void> {
  state.current = policy;
  const included = normalizeTypes(policy.exceptionBreakTypes).filter(
    (type) => !matchesTypeName(type, policy.exceptionIgnoreTypes),
  );
  const restrictToTypes = policy.exceptionPauseMode === 'none' && included.length > 0;
  await process.updateDebugSettings({
    logLevel: 'warn',
    hotCodeReplace: 'manual',
    exceptionFilters: {
      exceptionTypes: restrictToTypes ? included : [],
      allowClasses: [],
      skipClasses: [],
    },
    exceptionFiltersUpdated: true,
  });
  await client.request('setExceptionBreakpoints', {
    filters: javaExceptionFilters(policy, included),
  });
}

export async function shouldIgnoreJavaStopped(
  client: DapClient,
  state: JavaExceptionPolicyState,
  body: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  if (stringValue(body, 'reason') !== 'exception') return false;
  const threadId = typeof body.threadId === 'number' ? body.threadId : undefined;
  if (threadId === undefined) return false;
  const policy = state.current;
  const exception = asRecord(await client.request<unknown>('exceptionInfo', { threadId }));
  const details = asRecord(exception.details);
  const typeNames = [
    stringValue(exception, 'exceptionId'),
    stringValue(details, 'typeName'),
    stringValue(details, 'fullTypeName'),
  ].filter((value): value is string => value !== undefined);
  if (typeNames.some((name) => matchesTypeName(name, policy.exceptionIgnoreTypes))) return true;
  if (policy.exceptionPauseMode !== 'uncaught' || policy.exceptionBreakTypes.length === 0) {
    return false;
  }
  const breakMode = stringValue(exception, 'breakMode');
  if (breakMode === 'unhandled' || breakMode === 'userUnhandled') return false;
  return !typeNames.some((name) => matchesTypeName(name, policy.exceptionBreakTypes));
}

function javaExceptionFilters(
  policy: DebugExceptionPolicy,
  included: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (policy.exceptionPauseMode === 'all') return ['caught', 'uncaught'];
  if (policy.exceptionPauseMode === 'uncaught') {
    return included.length === 0 ? ['uncaught'] : ['caught', 'uncaught'];
  }
  return included.length === 0 ? [] : ['caught', 'uncaught'];
}

function normalizeTypes(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

function matchesTypeName(value: string, patterns: ReadonlyArray<string>): boolean {
  return normalizeTypes(patterns).some(
    (pattern) => value === pattern || value.endsWith(`.${pattern}`),
  );
}
