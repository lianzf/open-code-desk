import type {
  DebugAdapterCapabilities,
  DebugBreakpoint,
  DebugEvaluationResult,
  DebugExceptionPolicy,
  DebugExceptionInfo,
  DebugScope,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
} from '@open-code-desk/domain';

import type { StreamingSecretRedactor } from '../../run/run-process-runtime';
import type { DebugAdapterEvent, DebugAdapterSession } from '../debug-adapter';
import type { DapClient } from '../dap/dap-client';
import { DapDataAccess } from '../dap/dap-data-access';
import {
  createDapOutputRedactors,
  type DapOutputCategory,
  dapOutputCategories,
} from '../dap/dap-output-redaction';
import { setDapSpecialBreakpoints } from '../dap/dap-special-breakpoints';
import {
  handleNodeReverseRequest,
  type NodeDebugClientConfiguration,
  startNodeDebugClient,
} from './node-debug-client-lifecycle';
import { createInitializedNodeSession } from './node-debug-session-factory';
import { handleNodeDebugEvent } from './node-debug-session-events';
import {
  type AdditionalJavaScriptDebugSessionInput,
  type CreateNodeDebugAdapterSessionInput,
  type JavaScriptDebugAdapterProcess,
  runNodeToCursor,
  sendNodeBreakpoints,
} from './node-debug-session-support';

export type { CreateNodeDebugAdapterSessionInput } from './node-debug-session-support';
export type { AdditionalJavaScriptDebugSessionInput } from './node-debug-session-support';

export class NodeDebugAdapterSession implements DebugAdapterSession {
  readonly #listeners = new Set<(event: DebugAdapterEvent) => void>();
  readonly #bufferedEvents: DebugAdapterEvent[] = [];
  readonly #redactors: Readonly<Record<DapOutputCategory, StreamingSecretRedactor>>;
  readonly #clients = new Set<DapClient>();
  readonly #clientUnsubscribers = new Map<DapClient, ReadonlyArray<() => void>>();
  readonly #clientRoles = new Map<DapClient, 'primary' | 'child' | 'auxiliary'>();
  readonly #dataAccess: DapDataAccess;
  readonly #breakpointsByPath = new Map<string, ReadonlyArray<DebugBreakpoint>>();
  #functionBreakpoints: ReadonlyArray<DebugBreakpoint> = [];
  #dataBreakpoints: ReadonlyArray<DebugBreakpoint> = [];
  readonly #entryBootstrappedClients = new Set<DapClient>();
  readonly #unsubscribeExit: () => void;
  #debuggeeProcessId: number | undefined;
  readonly #terminateDebuggeeOnDisconnect = new Map<DapClient, boolean>();

  private constructor(
    private readonly process: JavaScriptDebugAdapterProcess,
    private readonly workspaceRoot: string,
    private readonly dapInitializeArguments: Readonly<Record<string, unknown>>,
    private readonly applyExceptionPolicy: (
      client: DapClient,
      policy: DebugExceptionPolicy,
    ) => Promise<void>,
    public readonly capabilities: DebugAdapterCapabilities,
    sensitiveValues: ReadonlyArray<string>,
    breakpoints: ReadonlyArray<DebugBreakpoint>,
    private exceptionPolicy: DebugExceptionPolicy,
    terminateDebuggeeOnDisconnect: boolean,
  ) {
    this.#dataAccess = new DapDataAccess(
      process.client,
      () => this.#clients,
      workspaceRoot,
      sensitiveValues,
    );
    this.#redactors = createDapOutputRedactors(sensitiveValues);
    this.#functionBreakpoints = breakpoints.filter((item) => item.kind === 'function');
    this.#dataBreakpoints = breakpoints.filter((item) => item.kind === 'data');
    for (const path of new Set(
      breakpoints.filter((item) => item.kind === 'line').map((item) => item.relativePath),
    )) {
      this.#breakpointsByPath.set(
        path,
        breakpoints.filter((item) => item.kind === 'line' && item.relativePath === path),
      );
    }
    this.attachClient(process.client, terminateDebuggeeOnDisconnect, 'primary');
    this.#unsubscribeExit = process.onExit(() => this.emit({ type: 'terminated', restart: false }));
  }

  public static async create(
    input: CreateNodeDebugAdapterSessionInput,
  ): Promise<NodeDebugAdapterSession> {
    return createInitializedNodeSession(
      input,
      (initialized) =>
        new NodeDebugAdapterSession(
          input.process,
          input.workspaceRoot,
          initialized.initializeArguments,
          initialized.applyExceptionPolicy,
          initialized.capabilities,
          input.sensitiveValues,
          input.breakpoints,
          input.exceptionPolicy,
          input.terminateDebuggeeOnDisconnect ?? true,
        ),
    );
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
    return this.#dataAccess.threadClient(threadId).request('continue', {
      threadId: this.#dataAccess.threadAdapterId(threadId),
    });
  }
  public pause(threadId: number): Promise<void> {
    return this.#dataAccess.threadClient(threadId).request('pause', {
      threadId: this.#dataAccess.threadAdapterId(threadId),
    });
  }
  public next(threadId: number): Promise<void> {
    return this.#dataAccess.threadClient(threadId).request('next', {
      threadId: this.#dataAccess.threadAdapterId(threadId),
      granularity: 'statement',
    });
  }
  public stepIn(threadId: number): Promise<void> {
    return this.#dataAccess.threadClient(threadId).request('stepIn', {
      threadId: this.#dataAccess.threadAdapterId(threadId),
      granularity: 'statement',
    });
  }
  public stepOut(threadId: number): Promise<void> {
    return this.#dataAccess.threadClient(threadId).request('stepOut', {
      threadId: this.#dataAccess.threadAdapterId(threadId),
      granularity: 'statement',
    });
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
    const results = await Promise.all(
      [...this.#clients].map((client) =>
        sendNodeBreakpoints(client, this.workspaceRoot, relativePath, breakpoints),
      ),
    );
    return results[0] ?? breakpoints;
  }

  public async setFunctionBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>> {
    this.#functionBreakpoints = [...breakpoints];
    const results = await Promise.all(
      [...this.#clients].map((client) =>
        setDapSpecialBreakpoints(
          client,
          'function',
          breakpoints,
          this.capabilities.functionBreakpoints,
        ),
      ),
    );
    return results[0] ?? breakpoints;
  }

  public async setDataBreakpoints(
    breakpoints: ReadonlyArray<DebugBreakpoint>,
  ): Promise<ReadonlyArray<DebugBreakpoint>> {
    this.#dataBreakpoints = [...breakpoints];
    const results = await Promise.all(
      [...this.#clients].map((client) =>
        setDapSpecialBreakpoints(client, 'data', breakpoints, this.capabilities.dataBreakpoints),
      ),
    );
    return results[0] ?? breakpoints;
  }

  public async setExceptionBreakpoints(policy: DebugExceptionPolicy): Promise<void> {
    await Promise.all(
      [...this.#clients].map((client) => this.applyExceptionPolicy(client, policy)),
    );
    this.exceptionPolicy = policy;
  }

  public async runToCursor(
    threadId: number,
    relativePath: string,
    line: number,
    column?: number,
  ): Promise<void> {
    const client = this.#dataAccess.threadClient(threadId);
    await runNodeToCursor(
      client,
      this.workspaceRoot,
      this.#dataAccess.threadAdapterId(threadId),
      relativePath,
      line,
      column,
    );
  }

  public async attachAdditionalClient(input: AdditionalJavaScriptDebugSessionInput): Promise<void> {
    const client = await this.process.connectClient();
    const applyExceptionPolicy = input.applyExceptionPolicy ?? this.applyExceptionPolicy;
    this.attachClient(client, input.terminateDebuggeeOnDisconnect ?? false, 'auxiliary');
    try {
      await startNodeDebugClient(
        client,
        input.initializeArguments,
        input.requestCommand,
        input.launchArguments,
        this.clientConfiguration(applyExceptionPolicy),
      );
    } catch (error) {
      this.detachClient(client);
      client.dispose();
      throw error;
    }
  }

  public async restart(): Promise<void> {
    await this.process.client.request('restart');
  }

  public async disconnect(): Promise<void> {
    await Promise.allSettled(
      [...this.#clients].map((client) =>
        client.request(
          'disconnect',
          {
            restart: false,
            terminateDebuggee: this.#terminateDebuggeeOnDisconnect.get(client) ?? false,
            suspendDebuggee: false,
          },
          3_000,
        ),
      ),
    );
    this.flushOutput();
    for (const disposers of this.#clientUnsubscribers.values())
      disposers.forEach((dispose) => dispose());
    this.#clientUnsubscribers.clear();
    this.#clients.clear();
    this.#clientRoles.clear();
    this.#terminateDebuggeeOnDisconnect.clear();
    this.#unsubscribeExit();
    this.#listeners.clear();
    await this.process.dispose();
  }

  private attachClient(
    client: DapClient,
    terminateDebuggeeOnDisconnect: boolean,
    role: 'primary' | 'child' | 'auxiliary',
  ): void {
    this.#clients.add(client);
    this.#clientRoles.set(client, role);
    this.#terminateDebuggeeOnDisconnect.set(client, terminateDebuggeeOnDisconnect);
    this.#clientUnsubscribers.set(client, [
      client.onEvent((event) => this.handleEvent(client, event)),
      client.onReverseRequest((command, argumentsValue) =>
        this.handleReverseRequest(command, argumentsValue),
      ),
    ]);
  }

  private detachClient(client: DapClient): void {
    this.#clientUnsubscribers.get(client)?.forEach((dispose) => dispose());
    this.#clientUnsubscribers.delete(client);
    this.#clientRoles.delete(client);
    this.#terminateDebuggeeOnDisconnect.delete(client);
    this.#clients.delete(client);
  }

  private async handleReverseRequest(command: string, argumentsValue: unknown): Promise<unknown> {
    return handleNodeReverseRequest(
      this.process,
      command,
      argumentsValue,
      this.dapInitializeArguments,
      this.clientConfiguration(this.applyExceptionPolicy),
      (client) => this.attachClient(client, true, 'child'),
      (client) => this.detachClient(client),
      (data) => this.emit({ type: 'output', category: 'telemetry', data }),
    );
  }

  private clientConfiguration(
    applyExceptionPolicy: NodeDebugClientConfiguration['applyExceptionPolicy'],
  ): NodeDebugClientConfiguration {
    return {
      workspaceRoot: this.workspaceRoot,
      breakpointsByPath: this.#breakpointsByPath,
      functionBreakpoints: this.#functionBreakpoints,
      dataBreakpoints: this.#dataBreakpoints,
      capabilities: this.capabilities,
      exceptionPolicy: this.exceptionPolicy,
      applyExceptionPolicy,
    };
  }

  private handleEvent(client: DapClient, event: Parameters<typeof handleNodeDebugEvent>[1]): void {
    handleNodeDebugEvent(client, event, {
      role: this.#clientRoles.get(client),
      setDebuggeeProcessId: (processId) => (this.#debuggeeProcessId = processId),
      pushOutput: (category, data) => {
        const redacted = this.#redactors[category].push(data);
        if (redacted !== '') this.emit({ type: 'output', category, data: redacted });
      },
      rememberThread: (threadId, dapClient) => this.#dataAccess.rememberThread(threadId, dapClient),
      bootstrapEntry: (dapClient, threadId, publicThreadId) => {
        if (this.#entryBootstrappedClients.has(dapClient)) return false;
        this.#entryBootstrappedClients.add(dapClient);
        void this.installBreakpointsAndContinue(dapClient, threadId, publicThreadId);
        return true;
      },
      flushOutput: () => this.flushOutput(),
      emit: (adapterEvent) => this.emit(adapterEvent),
    });
  }

  private async installBreakpointsAndContinue(
    client: DapClient,
    threadId: number,
    publicThreadId: number,
  ): Promise<void> {
    try {
      for (const [relativePath, breakpoints] of this.#breakpointsByPath) {
        await sendNodeBreakpoints(client, this.workspaceRoot, relativePath, breakpoints);
      }
      await client.request('continue', { threadId });
    } catch (error) {
      this.emit({
        type: 'stopped',
        threadId: publicThreadId,
        reason: 'entry',
        description:
          error instanceof Error ? `断点初始化失败：${error.message}` : '断点初始化失败。',
      });
    }
  }

  private flushOutput(): void {
    for (const category of dapOutputCategories) {
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
