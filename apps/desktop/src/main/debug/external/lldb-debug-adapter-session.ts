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
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import { StreamingSecretRedactor } from '../../run/run-process-runtime';
import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import type { DapClient } from '../dap/dap-client';
import { DapDataAccess } from '../dap/dap-data-access';
import type { DapEventMessage } from '../dap/dap-message';
import { setDapSpecialBreakpoints } from '../dap/dap-special-breakpoints';
import { asArray, asRecord, booleanValue, numberValue, stringValue } from '../dap/dap-values';
import type { ExternalDebugAdapterProcess } from './external-debug-adapter-process';

const outputCategories = ['console', 'stdout', 'stderr', 'telemetry', 'important'] as const;
type OutputCategory = (typeof outputCategories)[number];

export interface CreateExternalDebugAdapterSessionInput {
  readonly process: ExternalDebugAdapterProcess;
  readonly workspaceRoot: string;
  readonly adapterName: string;
  readonly initializeArguments: Readonly<Record<string, unknown>>;
  readonly mapCapabilities: (value: unknown) => DebugAdapterCapabilities;
  readonly applyExceptionPolicy: (client: DapClient, policy: DebugExceptionPolicy) => Promise<void>;
  readonly shouldIgnoreStopped?: (
    client: DapClient,
    body: Readonly<Record<string, unknown>>,
  ) => Promise<boolean>;
  readonly launchBeforeInitialized?: boolean;
  readonly launchArguments: Readonly<Record<string, unknown>>;
  readonly sensitiveValues: ReadonlyArray<string>;
  readonly breakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly exceptionPolicy: DebugExceptionPolicy;
}

export class ExternalDebugAdapterSession implements DebugAdapterSession {
  readonly #listeners = new Set<(event: DebugAdapterEvent) => void>();
  readonly #bufferedEvents: DebugAdapterEvent[] = [];
  readonly #redactors: Readonly<Record<OutputCategory, StreamingSecretRedactor>>;
  readonly #dataAccess: DapDataAccess;
  readonly #unsubscribeClient: ReadonlyArray<() => void>;
  readonly #unsubscribeExit: () => void;
  #debuggeeProcessId: number | undefined;

  private constructor(
    private readonly process: ExternalDebugAdapterProcess,
    private readonly workspaceRoot: string,
    private readonly adapterName: string,
    private readonly applyExceptionPolicy: CreateExternalDebugAdapterSessionInput['applyExceptionPolicy'],
    private readonly shouldIgnoreStopped: CreateExternalDebugAdapterSessionInput['shouldIgnoreStopped'],
    public readonly capabilities: DebugAdapterCapabilities,
    sensitiveValues: ReadonlyArray<string>,
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
    this.#unsubscribeClient = [
      process.client.onEvent((event) => this.handleEvent(event)),
      process.client.onReverseRequest(async (command) => {
        throw new Error(`${adapterName} reverse request ${command} is not supported.`);
      }),
      process.onLog((stream, data) => this.pushOutput(stream, data)),
    ];
    this.#unsubscribeExit = process.onExit(() => this.emit({ type: 'terminated', restart: false }));
  }

  public static async create(
    input: CreateExternalDebugAdapterSessionInput,
  ): Promise<ExternalDebugAdapterSession> {
    const initializedEvent = input.process.client.waitForEvent('initialized', 60_000);
    void initializedEvent.catch(() => undefined);
    let session: ExternalDebugAdapterSession | undefined;
    try {
      const initializeBody = await input.process.client.request<unknown>(
        'initialize',
        input.initializeArguments,
        60_000,
      );
      session = new ExternalDebugAdapterSession(
        input.process,
        input.workspaceRoot,
        input.adapterName,
        input.applyExceptionPolicy,
        input.shouldIgnoreStopped,
        input.mapCapabilities(initializeBody),
        input.sensitiveValues,
      );
      let launchPromise: Promise<unknown> | undefined;
      if (input.launchBeforeInitialized === true) {
        launchPromise = input.process.client.request<unknown>(
          'launch',
          input.launchArguments,
          60_000,
        );
        void launchPromise.catch(() => undefined);
      }
      await waitForInitializedOrLaunchFailure(initializedEvent, launchPromise);
      if (launchPromise === undefined) {
        launchPromise = input.process.client.request<unknown>(
          'launch',
          input.launchArguments,
          60_000,
        );
        void launchPromise.catch(() => undefined);
      }
      for (const path of new Set(
        input.breakpoints.filter((item) => item.kind === 'line').map((item) => item.relativePath),
      )) {
        await session.setBreakpoints(
          path,
          input.breakpoints.filter((item) => item.kind === 'line' && item.relativePath === path),
        );
      }
      await session.setFunctionBreakpoints(
        input.breakpoints.filter((item) => item.kind === 'function'),
      );
      await session.setDataBreakpoints(input.breakpoints.filter((item) => item.kind === 'data'));
      await input.applyExceptionPolicy(input.process.client, input.exceptionPolicy);
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

  public setExceptionBreakpoints(policy: DebugExceptionPolicy): Promise<void> {
    return this.applyExceptionPolicy(this.process.client, policy);
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
    if (targetId === undefined)
      throw new Error(`There is no executable ${this.adapterName} target at the cursor.`);
    await this.process.client.request('goto', { threadId, targetId });
  }

  public restart(): Promise<void> {
    return this.process.client.request('restart');
  }

  public async disconnect(): Promise<void> {
    await this.process.client
      .request(
        'disconnect',
        { restart: false, terminateDebuggee: true, suspendDebuggee: false },
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
      void this.handleStopped(body);
    } else if (event.event === 'continued') {
      const threadId = numberValue(body, 'threadId');
      this.emit({ type: 'continued', ...(threadId === undefined ? {} : { threadId }) });
    } else if (event.event === 'terminated' || event.event === 'exited') {
      this.flushOutput();
      this.emit({ type: 'terminated', restart: booleanValue(body, 'restart') ?? false });
    } else if (event.event === 'breakpoint') {
      this.emitBreakpoint(body);
    }
  }

  private async handleStopped(body: Readonly<Record<string, unknown>>): Promise<void> {
    const threadId = numberValue(body, 'threadId');
    if (threadId === undefined) return;
    this.#dataAccess.rememberThread(threadId, this.process.client);
    if (
      this.shouldIgnoreStopped !== undefined &&
      (await this.shouldIgnoreStopped(this.process.client, body).catch(() => false))
    ) {
      await this.process.client.request('continue', { threadId }).catch(() => undefined);
      return;
    }
    const description = stringValue(body, 'description');
    this.emit({
      type: 'stopped',
      threadId,
      reason: stringValue(body, 'reason') ?? 'pause',
      ...(description === undefined ? {} : { description }),
    });
  }

  private emitBreakpoint(body: Readonly<Record<string, unknown>>): void {
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

function waitForInitializedOrLaunchFailure(
  initializedEvent: Promise<unknown>,
  launchPromise: Promise<unknown> | undefined,
): Promise<unknown> {
  if (launchPromise === undefined) return initializedEvent;
  const launchFailure = launchPromise.then(
    () => new Promise<never>(() => undefined),
    (error: unknown) => Promise.reject(error instanceof Error ? error : new Error(String(error))),
  );
  return Promise.race([initializedEvent, launchFailure]);
}
