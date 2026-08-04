import type {
  DebugAdapterCapabilities,
  DebugBreakpoint,
  DebugEvaluationResult,
  DebugExceptionInfo,
  DebugExceptionPolicy,
  DebugScope,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import { StreamingSecretRedactor } from '../../run/run-process-runtime';
import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import { DapDataAccess } from '../dap/dap-data-access';
import type { DapEventMessage } from '../dap/dap-message';
import { setDapSpecialBreakpoints } from '../dap/dap-special-breakpoints';
import { asArray, asRecord, booleanValue, numberValue, stringValue } from '../dap/dap-values';
import { PythonDebugAdapterProcess } from './python-debug-adapter-process';
import { matchesPythonExceptionType } from './python-exception-policy';
import {
  createPythonLaunchArguments,
  mapPythonCapabilities,
  pythonInitializeArguments,
  setPythonExceptionBreakpoints,
} from './python-debug-launch';

const outputCategories = ['console', 'stdout', 'stderr', 'telemetry', 'important'] as const;
type OutputCategory = (typeof outputCategories)[number];

export interface CreatePythonDebugAdapterSessionInput {
  readonly process: PythonDebugAdapterProcess;
  readonly workspaceRoot: string;
  readonly command: RunCommandSnapshot;
  readonly environment: Readonly<Record<string, string>>;
  readonly sensitiveValues: ReadonlyArray<string>;
  readonly breakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly exceptionPolicy: DebugExceptionPolicy;
  readonly requestCommand?: 'launch' | 'attach';
  readonly requestArguments?: Readonly<Record<string, unknown>>;
  readonly terminateDebuggeeOnDisconnect?: boolean;
}

export class PythonDebugAdapterSession implements DebugAdapterSession {
  readonly #listeners = new Set<(event: DebugAdapterEvent) => void>();
  readonly #bufferedEvents: DebugAdapterEvent[] = [];
  readonly #redactors: Readonly<Record<OutputCategory, StreamingSecretRedactor>>;
  readonly #dataAccess: DapDataAccess;
  readonly #breakpointsByPath = new Map<string, ReadonlyArray<DebugBreakpoint>>();
  readonly #unsubscribeClient: ReadonlyArray<() => void>;
  readonly #unsubscribeExit: () => void;
  #debuggeeProcessId: number | undefined;

  private constructor(
    private readonly process: PythonDebugAdapterProcess,
    private readonly workspaceRoot: string,
    public readonly capabilities: DebugAdapterCapabilities,
    sensitiveValues: ReadonlyArray<string>,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
    private exceptionPolicy: DebugExceptionPolicy,
    private readonly terminateDebuggeeOnDisconnect: boolean,
  ) {
    this.#dataAccess = new DapDataAccess(
      process.client,
      () => [process.client],
      workspaceRoot,
      sensitiveValues,
    );
    this.#redactors = Object.fromEntries(
      outputCategories.map((category) => [category, new StreamingSecretRedactor(sensitiveValues)]),
    ) as Readonly<Record<OutputCategory, StreamingSecretRedactor>>;
    for (const path of new Set(
      breakpoints.filter((item) => item.kind === 'line').map((item) => item.relativePath),
    )) {
      this.#breakpointsByPath.set(
        path,
        breakpoints.filter((item) => item.kind === 'line' && item.relativePath === path),
      );
    }
    this.#unsubscribeClient = [
      process.client.onEvent((event) => this.handleEvent(event)),
      process.client.onReverseRequest((command) => {
        throw new Error(`Python 调试器发起了不受支持的反向请求 ${command}。`);
      }),
      process.onLog((stream, data) => this.pushOutput(stream, data)),
    ];
    this.#unsubscribeExit = process.onExit(() => this.emit({ type: 'terminated', restart: false }));
  }

  public static async create(
    input: CreatePythonDebugAdapterSessionInput,
  ): Promise<PythonDebugAdapterSession> {
    const initializedEvent = input.process.client.waitForEvent('initialized', 60_000);
    void initializedEvent.catch(() => undefined);
    let session: PythonDebugAdapterSession | undefined;
    try {
      const initializeBody = await input.process.client.request<unknown>(
        'initialize',
        pythonInitializeArguments,
        60_000,
      );
      session = new PythonDebugAdapterSession(
        input.process,
        input.workspaceRoot,
        mapPythonCapabilities(initializeBody),
        input.sensitiveValues,
        input.breakpoints,
        input.exceptionPolicy,
        input.terminateDebuggeeOnDisconnect ?? true,
      );
      const launchPromise = input.process.client.request<unknown>(
        input.requestCommand ?? 'launch',
        input.requestArguments ??
          createPythonLaunchArguments(input.command, input.workspaceRoot, input.environment),
        60_000,
      );
      void launchPromise.catch(() => undefined);
      await initializedEvent;
      for (const path of new Set(
        input.breakpoints.filter((item) => item.kind === 'line').map((item) => item.relativePath),
      )) {
        await session.setBreakpoints(
          path,
          input.breakpoints.filter((item) => item.relativePath === path),
        );
      }
      await session.setFunctionBreakpoints(
        input.breakpoints.filter((item) => item.kind === 'function'),
      );
      await session.setDataBreakpoints(input.breakpoints.filter((item) => item.kind === 'data'));
      await setPythonExceptionBreakpoints(input.process.client, input.exceptionPolicy);
      await input.process.client.request('configurationDone');
      await launchPromise;
      return session;
    } catch (error) {
      if (session === undefined) await input.process.dispose();
      else await session.disconnect();
      throw error;
    }
  }

  public get processId(): number {
    return this.#debuggeeProcessId ?? this.process.processId;
  }

  public subscribe(listener: (event: DebugAdapterEvent) => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      for (const event of this.#bufferedEvents.splice(0)) listener(event);
    }
    return () => this.#listeners.delete(listener);
  }

  public continue(threadId: number): Promise<void> {
    return this.process.client.request('continue', { threadId });
  }

  public pause(threadId: number): Promise<void> {
    return this.process.client.request('pause', { threadId });
  }

  public next(threadId: number): Promise<void> {
    return this.process.client.request('next', { threadId, granularity: 'statement' });
  }

  public stepIn(threadId: number): Promise<void> {
    return this.process.client.request('stepIn', { threadId, granularity: 'statement' });
  }

  public stepOut(threadId: number): Promise<void> {
    return this.process.client.request('stepOut', { threadId, granularity: 'statement' });
  }

  public threads(): Promise<ReadonlyArray<DebugThread>> {
    return this.#dataAccess.threads();
  }

  public stackTrace(threadId: number): Promise<ReadonlyArray<DebugStackFrame>> {
    return this.#dataAccess.stackTrace(threadId);
  }

  public scopes(frameId: number): Promise<ReadonlyArray<DebugScope>> {
    return this.#dataAccess.scopes(frameId);
  }

  public variables(reference: number): Promise<ReadonlyArray<DebugVariable>> {
    return this.#dataAccess.variables(reference);
  }

  public evaluate(
    expression: string,
    frameId: number | undefined,
    context: 'watch' | 'repl' | 'hover',
  ): Promise<DebugEvaluationResult> {
    return this.#dataAccess.evaluate(expression, frameId, context);
  }

  public exceptionInfo(threadId: number): Promise<DebugExceptionInfo | undefined> {
    return this.#dataAccess.exceptionInfo(threadId, this.capabilities.exceptionInfo);
  }

  public async setBreakpoints(
    relativePath: string,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>> {
    this.#breakpointsByPath.set(relativePath, [...breakpoints]);
    const enabled = breakpoints.filter((item) => item.enabled);
    const body = asRecord(
      await this.process.client.request<unknown>('setBreakpoints', {
        source: { path: toPlatformPath(this.workspaceRoot, relativePath) },
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

  public setFunctionBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>> {
    return setDapSpecialBreakpoints(
      this.process.client,
      'function',
      breakpoints,
      this.capabilities.functionBreakpoints,
    );
  }

  public setDataBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>> {
    return setDapSpecialBreakpoints(
      this.process.client,
      'data',
      breakpoints,
      this.capabilities.dataBreakpoints,
    );
  }

  public async setExceptionBreakpoints(policy: DebugExceptionPolicy): Promise<void> {
    await setPythonExceptionBreakpoints(this.process.client, policy);
    this.exceptionPolicy = policy;
  }

  public async runToCursor(
    threadId: number,
    relativePath: string,
    line: number,
    column?: number,
  ): Promise<void> {
    const body = asRecord(
      await this.process.client.request<unknown>('gotoTargets', {
        source: { path: toPlatformPath(this.workspaceRoot, relativePath) },
        line,
        ...(column === undefined ? {} : { column }),
      }),
    );
    const targetId = numberValue(asRecord(asArray(body.targets)[0]), 'id');
    if (targetId === undefined) throw new Error('当前光标位置没有可执行的 Python 调试目标。');
    await this.process.client.request('goto', { threadId, targetId });
  }

  public async restart(): Promise<void> {
    await this.process.client.request('restart');
  }

  public async disconnect(): Promise<void> {
    await this.process.client
      .request(
        'disconnect',
        {
          restart: false,
          terminateDebuggee: this.terminateDebuggeeOnDisconnect,
          suspendDebuggee: false,
        },
        3_000,
      )
      .catch(() => undefined);
    this.flushOutput();
    this.#unsubscribeClient.forEach((dispose) => dispose());
    this.#unsubscribeExit();
    this.#listeners.clear();
    await this.process.dispose();
  }

  private handleEvent(event: DapEventMessage): void {
    const body = asRecord(event.body);
    if (event.event === 'process') {
      this.#debuggeeProcessId = numberValue(body, 'systemProcessId');
    } else if (event.event === 'output') {
      const rawCategory = stringValue(body, 'category');
      const category = outputCategories.find((value) => value === rawCategory) ?? 'console';
      this.pushOutput(category, stringValue(body, 'output') ?? '');
    } else if (event.event === 'stopped') {
      const threadId = numberValue(body, 'threadId');
      if (threadId !== undefined) {
        this.#dataAccess.rememberThread(threadId, this.process.client);
        const description = stringValue(body, 'description');
        const reason = stringValue(body, 'reason') ?? 'pause';
        if (reason === 'exception' && this.exceptionPolicy.exceptionIgnoreTypes.length > 0) {
          void this.handlePossibleIgnoredException(threadId, reason, description);
        } else {
          this.emitStopped(threadId, reason, description);
        }
      }
    } else if (event.event === 'continued') {
      const threadId = numberValue(body, 'threadId');
      this.emit({ type: 'continued', ...(threadId === undefined ? {} : { threadId }) });
    } else if (event.event === 'terminated' || event.event === 'exited') {
      this.flushOutput();
      this.emit({ type: 'terminated', restart: booleanValue(body, 'restart') ?? false });
    } else if (event.event === 'breakpoint') {
      const breakpoint = asRecord(body.breakpoint);
      const adapterBreakpointId = numberValue(breakpoint, 'id');
      const message = stringValue(breakpoint, 'message');
      const line = numberValue(breakpoint, 'line');
      const column = numberValue(breakpoint, 'column');
      const sourcePath = stringValue(asRecord(breakpoint.source), 'path');
      this.emit({
        type: 'breakpoint',
        ...(adapterBreakpointId === undefined ? {} : { adapterBreakpointId }),
        verified: booleanValue(breakpoint, 'verified') ?? false,
        ...(message === undefined ? {} : { message }),
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
        ...(sourcePath === undefined ? {} : { sourcePath }),
      });
    }
  }

  private async handlePossibleIgnoredException(
    threadId: number,
    reason: string,
    description: string | undefined,
  ): Promise<void> {
    try {
      const exception = await this.exceptionInfo(threadId);
      if (
        exception !== undefined &&
        matchesPythonExceptionType(exception, this.exceptionPolicy.exceptionIgnoreTypes)
      ) {
        await this.continue(threadId);
        return;
      }
    } catch {
      // Keep the pause visible if debugpy cannot identify or resume the exception safely.
    }
    this.emitStopped(threadId, reason, description);
  }

  private emitStopped(threadId: number, reason: string, description: string | undefined): void {
    this.emit({
      type: 'stopped',
      threadId,
      reason,
      ...(description === undefined ? {} : { description }),
    });
  }

  private pushOutput(category: OutputCategory, data: string): void {
    const redacted = this.#redactors[category].push(data);
    if (redacted !== '') this.emit({ type: 'output', category, data: redacted });
  }

  private flushOutput(): void {
    for (const category of outputCategories) {
      const data = this.#redactors[category].flush();
      if (data !== '') this.emit({ type: 'output', category, data });
    }
  }

  private emit(event: DebugAdapterEvent): void {
    if (this.#listeners.size === 0) {
      this.#bufferedEvents.push(event);
      if (this.#bufferedEvents.length > 1_000) this.#bufferedEvents.shift();
      return;
    }
    for (const listener of this.#listeners) listener(event);
  }
}
