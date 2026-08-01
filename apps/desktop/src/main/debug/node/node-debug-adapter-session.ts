import type {
  DebugAdapterCapabilities,
  DebugBreakpoint,
  DebugEvaluationResult,
  DebugExceptionPauseMode,
  DebugExceptionInfo,
  DebugScope,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  RunCommandSnapshot,
} from '@open-code-desk/domain';

import { toPlatformPath } from '../../filesystem/path-policy';
import { StreamingSecretRedactor } from '../../run/run-process-runtime';
import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import type { DapClient } from '../dap/dap-client';
import type { DapEventMessage } from '../dap/dap-message';
import { asArray, asRecord, booleanValue, numberValue, stringValue } from './dap-values';
import { NodeDebugDataAccess } from './node-debug-data-access';
import { NodeDebugAdapterProcess } from './node-debug-adapter-process';
import {
  createLaunchArguments,
  initializeArguments,
  mapCapabilities,
  setNodeExceptionBreakpoints,
} from './node-debug-launch';

const outputCategories = ['console', 'stdout', 'stderr', 'telemetry', 'important'] as const;
type OutputCategory = (typeof outputCategories)[number];

export interface CreateNodeDebugAdapterSessionInput {
  readonly process: NodeDebugAdapterProcess;
  readonly workspaceRoot: string;
  readonly command: RunCommandSnapshot;
  readonly environment: Readonly<Record<string, string>>;
  readonly sensitiveValues: ReadonlyArray<string>;
  readonly breakpoints: ReadonlyArray<DebugBreakpoint>;
  readonly exceptionPauseMode: DebugExceptionPauseMode;
}

export class NodeDebugAdapterSession implements DebugAdapterSession {
  readonly #listeners = new Set<(event: DebugAdapterEvent) => void>();
  readonly #bufferedEvents: DebugAdapterEvent[] = [];
  readonly #redactors: Readonly<Record<OutputCategory, StreamingSecretRedactor>>;
  readonly #clients = new Set<DapClient>();
  readonly #clientUnsubscribers = new Map<DapClient, ReadonlyArray<() => void>>();
  readonly #dataAccess: NodeDebugDataAccess;
  readonly #breakpointsByPath = new Map<string, ReadonlyArray<DebugBreakpoint>>();
  readonly #entryBootstrappedClients = new Set<DapClient>();
  readonly #unsubscribeExit: () => void;

  private constructor(
    private readonly process: NodeDebugAdapterProcess,
    private readonly workspaceRoot: string,
    public readonly capabilities: DebugAdapterCapabilities,
    sensitiveValues: ReadonlyArray<string>,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
    private exceptionPauseMode: DebugExceptionPauseMode,
  ) {
    this.#dataAccess = new NodeDebugDataAccess(
      process.client,
      () => this.#clients,
      workspaceRoot,
      sensitiveValues,
    );
    this.#redactors = Object.fromEntries(
      outputCategories.map((category) => [category, new StreamingSecretRedactor(sensitiveValues)]),
    ) as Readonly<Record<OutputCategory, StreamingSecretRedactor>>;
    for (const path of new Set(breakpoints.map((item) => item.relativePath))) {
      this.#breakpointsByPath.set(
        path,
        breakpoints.filter((item) => item.relativePath === path),
      );
    }
    this.attachClient(process.client);
    this.#unsubscribeExit = process.onExit(() => this.emit({ type: 'terminated', restart: false }));
  }

  public static async create(
    input: CreateNodeDebugAdapterSessionInput,
  ): Promise<NodeDebugAdapterSession> {
    const initializedEvent = input.process.client.waitForEvent('initialized');
    const initializeBody = await input.process.client.request<unknown>(
      'initialize',
      initializeArguments,
    );
    const session = new NodeDebugAdapterSession(
      input.process,
      input.workspaceRoot,
      mapCapabilities(initializeBody),
      input.sensitiveValues,
      input.breakpoints,
      input.exceptionPauseMode,
    );
    await initializedEvent;
    const launchPromise = input.process.client.request<unknown>(
      'launch',
      createLaunchArguments(input.command, input.workspaceRoot, input.environment),
      60_000,
    );
    try {
      for (const path of new Set(input.breakpoints.map((item) => item.relativePath))) {
        await session.setBreakpoints(
          path,
          input.breakpoints.filter((item) => item.relativePath === path),
        );
      }
      await setNodeExceptionBreakpoints(input.process.client, input.exceptionPauseMode);
      await input.process.client.request('configurationDone');
      await launchPromise;
      return session;
    } catch (error) {
      await session.disconnect();
      throw error;
    }
  }

  public get processId(): number {
    return this.process.processId;
  }

  public subscribe(listener: (event: DebugAdapterEvent) => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      for (const event of this.#bufferedEvents.splice(0)) listener(event);
    }
    return () => this.#listeners.delete(listener);
  }

  public continue(threadId: number): Promise<void> {
    return this.#dataAccess.threadClient(threadId).request('continue', { threadId });
  }

  public pause(threadId: number): Promise<void> {
    return this.#dataAccess.threadClient(threadId).request('pause', { threadId });
  }

  public next(threadId: number): Promise<void> {
    return this.#dataAccess
      .threadClient(threadId)
      .request('next', { threadId, granularity: 'statement' });
  }

  public stepIn(threadId: number): Promise<void> {
    return this.#dataAccess
      .threadClient(threadId)
      .request('stepIn', { threadId, granularity: 'statement' });
  }

  public stepOut(threadId: number): Promise<void> {
    return this.#dataAccess
      .threadClient(threadId)
      .request('stepOut', { threadId, granularity: 'statement' });
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

  public async evaluate(
    expression: string,
    frameId: number | undefined,
    context: 'watch' | 'repl' | 'hover',
  ): Promise<DebugEvaluationResult> {
    return this.#dataAccess.evaluate(expression, frameId, context);
  }

  public async exceptionInfo(threadId: number): Promise<DebugExceptionInfo | undefined> {
    return this.#dataAccess.exceptionInfo(threadId, this.capabilities.exceptionInfo);
  }

  public async setBreakpoints(
    relativePath: string,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>> {
    this.#breakpointsByPath.set(relativePath, [...breakpoints]);
    return this.sendBreakpoints(this.process.client, relativePath, breakpoints);
  }

  private async sendBreakpoints(
    client: DapClient,
    relativePath: string,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>> {
    const enabled = breakpoints.filter((item) => item.enabled);
    const body = asRecord(
      await client.request<unknown>('setBreakpoints', {
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

  public async setExceptionBreakpoints(mode: DebugExceptionPauseMode): Promise<void> {
    await Promise.all(
      [...this.#clients].map((client) => setNodeExceptionBreakpoints(client, mode)),
    );
    this.exceptionPauseMode = mode;
  }

  public async runToCursor(
    threadId: number,
    relativePath: string,
    line: number,
    column?: number,
  ): Promise<void> {
    const client = this.#dataAccess.threadClient(threadId);
    const body = asRecord(
      await client.request<unknown>('gotoTargets', {
        source: { path: toPlatformPath(this.workspaceRoot, relativePath) },
        line,
        ...(column === undefined ? {} : { column }),
      }),
    );
    const targetId = numberValue(asRecord(asArray(body.targets)[0]), 'id');
    if (targetId === undefined) throw new Error('当前光标位置没有可执行的调试目标。');
    await client.request('goto', { threadId, targetId });
  }

  public async restart(): Promise<void> {
    await this.process.client.request('restart');
  }

  public async disconnect(): Promise<void> {
    await Promise.allSettled(
      [...this.#clients].map((client) =>
        client.request(
          'disconnect',
          { restart: false, terminateDebuggee: true, suspendDebuggee: false },
          3_000,
        ),
      ),
    );
    this.flushOutput();
    for (const disposers of this.#clientUnsubscribers.values())
      disposers.forEach((dispose) => dispose());
    this.#clientUnsubscribers.clear();
    this.#clients.clear();
    this.#unsubscribeExit();
    this.#listeners.clear();
    await this.process.dispose();
  }

  private attachClient(client: DapClient): void {
    this.#clients.add(client);
    this.#clientUnsubscribers.set(client, [
      client.onEvent((event) => this.handleEvent(client, event)),
      client.onReverseRequest((command, argumentsValue) =>
        this.handleReverseRequest(command, argumentsValue),
      ),
    ]);
  }

  private async handleReverseRequest(command: string, argumentsValue: unknown): Promise<unknown> {
    this.emit({ type: 'output', category: 'telemetry', data: `dap.reverse/${command}` });
    if (command !== 'startDebugging') {
      throw new Error(`暂不支持调试器反向请求 ${command}。`);
    }
    const request = asRecord(argumentsValue);
    const configuration = asRecord(request.configuration);
    if (!['launch', 'attach'].includes(stringValue(request, 'request') ?? '')) {
      throw new Error('调试器请求了无效的子会话类型。');
    }
    const client = await this.process.connectClient();
    this.attachClient(client);
    const initializedEvent = client.waitForEvent('initialized');
    await client.request('initialize', initializeArguments);
    await initializedEvent;
    const launchPromise = client.request('launch', configuration, 60_000);
    for (const [relativePath, breakpoints] of this.#breakpointsByPath) {
      await this.sendBreakpoints(client, relativePath, breakpoints);
    }
    await setNodeExceptionBreakpoints(client, this.exceptionPauseMode);
    await client.request('configurationDone');
    await launchPromise;
    return {};
  }

  private handleEvent(client: DapClient, event: DapEventMessage): void {
    const body = asRecord(event.body);
    if (event.event === 'output') {
      const rawCategory = stringValue(body, 'category');
      const category = outputCategories.find((value) => value === rawCategory) ?? 'console';
      const data = this.#redactors[category].push(stringValue(body, 'output') ?? '');
      if (data !== '') this.emit({ type: 'output', category, data });
    } else if (event.event === 'stopped') {
      const threadId = numberValue(body, 'threadId');
      if (threadId !== undefined) {
        this.#dataAccess.rememberThread(threadId, client);
        if (
          stringValue(body, 'reason') === 'entry' &&
          !this.#entryBootstrappedClients.has(client)
        ) {
          this.#entryBootstrappedClients.add(client);
          void this.installBreakpointsAndContinue(client, threadId);
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
    } else if (event.event === 'continued') {
      const threadId = numberValue(body, 'threadId');
      this.emit({ type: 'continued', ...(threadId === undefined ? {} : { threadId }) });
    } else if (event.event === 'terminated' || event.event === 'exited') {
      this.flushOutput();
      this.emit({ type: 'terminated', restart: booleanValue(body, 'restart') ?? false });
    } else if (event.event === 'breakpoint') {
      this.emitBreakpoint(asRecord(body.breakpoint));
    }
  }

  private emitBreakpoint(value: Readonly<Record<string, unknown>>): void {
    const adapterBreakpointId = numberValue(value, 'id');
    const message = stringValue(value, 'message');
    const line = numberValue(value, 'line');
    const column = numberValue(value, 'column');
    const sourcePath = stringValue(asRecord(value.source), 'path');
    this.emit({
      type: 'breakpoint',
      ...(adapterBreakpointId === undefined ? {} : { adapterBreakpointId }),
      verified: booleanValue(value, 'verified') ?? false,
      ...(message === undefined ? {} : { message }),
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
      ...(sourcePath === undefined ? {} : { sourcePath }),
    });
  }

  private async installBreakpointsAndContinue(client: DapClient, threadId: number): Promise<void> {
    try {
      for (const [relativePath, breakpoints] of this.#breakpointsByPath) {
        await this.sendBreakpoints(client, relativePath, breakpoints);
      }
      await client.request('continue', { threadId });
    } catch (error) {
      this.emit({
        type: 'stopped',
        threadId,
        reason: 'entry',
        description:
          error instanceof Error ? `断点初始化失败：${error.message}` : '断点初始化失败。',
      });
    }
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
