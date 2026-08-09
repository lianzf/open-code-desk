import type {
  DebugBreakpoint,
  DebugExceptionPolicy,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import type { DebugAdapterEvent } from '../debug-adapter';
import type { DapClient } from '../dap/dap-client';
import { asArray, asRecord, booleanValue, numberValue, stringValue } from '../dap/dap-values';
export interface JavaScriptDebugAdapterProcess {
  readonly client: DapClient;
  readonly processId: number;
  onLog(listener: (stream: 'stdout' | 'stderr', chunk: string) => void): () => void;
  onExit(listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): () => void;
  connectClient(): Promise<DapClient>;
  dispose(): Promise<void>;
}

export interface CreateNodeDebugAdapterSessionInput {
  readonly process: JavaScriptDebugAdapterProcess;
  readonly workspaceRoot: string;
  readonly command: RunCommandSnapshot;
  readonly environment: Readonly<Record<string, string>>;
  readonly sensitiveValues: ReadonlyArray<string>;
  readonly breakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly exceptionPolicy: DebugExceptionPolicy;
  readonly initializeArguments?: Readonly<Record<string, unknown>>;
  readonly requestCommand?: 'launch' | 'attach';
  readonly launchArguments?: Readonly<Record<string, unknown>>;
  readonly terminateDebuggeeOnDisconnect?: boolean;
  readonly applyExceptionPolicy?: (
    client: DapClient,
    policy: DebugExceptionPolicy,
  ) => Promise<void>;
}

export interface AdditionalJavaScriptDebugSessionInput {
  readonly initializeArguments: Readonly<Record<string, unknown>>;
  readonly requestCommand: 'launch' | 'attach';
  readonly launchArguments: Readonly<Record<string, unknown>>;
  readonly terminateDebuggeeOnDisconnect?: boolean;
  readonly applyExceptionPolicy?: (
    client: DapClient,
    policy: DebugExceptionPolicy,
  ) => Promise<void>;
}

export async function sendNodeBreakpoints(
  client: DapClient,
  workspaceRoot: string,
  relativePath: string,
  breakpoints: ReadonlyArray<DebugBreakpoint>,
): Promise<ReadonlyArray<DebugBreakpoint>> {
  const enabled = breakpoints.filter((item) => item.enabled);
  const body = asRecord(
    await client.request<unknown>('setBreakpoints', {
      source: { path: toPlatformPath(workspaceRoot, relativePath) },
      breakpoints: enabled.map((item) => ({
        line: item.line,
        ...(item.column === undefined ? {} : { column: item.column }),
        ...(item.condition === undefined ? {} : { condition: item.condition }),
        ...(item.hitCondition === undefined ? {} : { hitCondition: item.hitCondition }),
        ...(item.logMessage === undefined ? {} : { logMessage: item.logMessage }),
      })),
      sourceModified: false,
    }),
  );
  const results = asArray(body.breakpoints);
  let enabledIndex = 0;
  return breakpoints.map((item) => {
    if (!item.enabled) return { ...item, status: 'disabled' };
    const result = asRecord(results[enabledIndex++]);
    const adapterBreakpointId = numberValue(result, 'id');
    const message = stringValue(result, 'message');
    return {
      ...item,
      status: booleanValue(result, 'verified') === true ? 'verified' : 'unverified',
      ...(adapterBreakpointId === undefined ? {} : { adapterBreakpointId }),
      ...(message === undefined ? {} : { message }),
    };
  });
}

export async function runNodeToCursor(
  client: DapClient,
  workspaceRoot: string,
  threadId: number,
  relativePath: string,
  line: number,
  column?: number,
): Promise<void> {
  const body = asRecord(
    await client.request<unknown>('gotoTargets', {
      source: { path: toPlatformPath(workspaceRoot, relativePath) },
      line,
      ...(column === undefined ? {} : { column }),
    }),
  );
  const targetId = numberValue(asRecord(asArray(body.targets)[0]), 'id');
  if (targetId === undefined) throw new Error('当前光标位置没有可执行的调试目标。');
  await client.request('goto', { threadId, targetId });
}

export function dapBreakpointEvent(value: Readonly<Record<string, unknown>>): DebugAdapterEvent {
  const adapterBreakpointId = numberValue(value, 'id');
  const message = stringValue(value, 'message');
  const line = numberValue(value, 'line');
  const column = numberValue(value, 'column');
  const sourcePath = stringValue(asRecord(value.source), 'path');
  return {
    type: 'breakpoint',
    ...(adapterBreakpointId === undefined ? {} : { adapterBreakpointId }),
    verified: booleanValue(value, 'verified') ?? false,
    ...(message === undefined ? {} : { message }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
  };
}
