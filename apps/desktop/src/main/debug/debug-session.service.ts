import type {
  DebugBreakpoint,
  DebugEvaluationResult,
  DebugEvent,
  DebugScope,
  DebugSession,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  DebugWatchExpression,
} from '@open-code-desk/domain';
import type {
  DecideDebugStartRequest,
  DeleteDebugBreakpointRequest,
  DeleteDebugWatchRequest,
  EvaluateDebugRequest,
  ListDebugBreakpointsRequest,
  ListDebugHistoryRequest,
  ListDebugWatchesRequest,
  ProposeDebugStartRequest,
  RunToCursorRequest,
  SaveDebugBreakpointRequest,
  SaveDebugWatchRequest,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import type { RunConfigurationRepository } from '../run/run-configuration.repository';
import { resolveRunEnvironment } from '../run/run-execution-policy';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { DebugAdapterEvent } from './debug-adapter';
import type { DebugAdapterRegistry } from './debug-adapter.registry';
import { handleDebugAdapterEvent, type ActiveDebugSession } from './debug-adapter-event-handler';
import { DebugBreakpointCoordinator } from './debug-breakpoint-coordinator';
import type { DebugBreakpointRepository } from './debug-breakpoint.repository';
import { DebugProposalService } from './debug-proposal.service';
import { recordDebugSessionAudit } from './debug-session-audit';
import { DebugSessionController } from './debug-session-controller';
import type { DebugSessionRepository } from './debug-session.repository';
import type { DebugWatchRepository } from './debug-watch.repository';

type DebugListener = (event: DebugEvent) => void;

export class DebugSessionService {
  readonly #active = new Map<string, ActiveDebugSession>();
  readonly #listeners = new Set<DebugListener>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #sequences = new Map<string, number>();
  readonly #breakpointCoordinator: DebugBreakpointCoordinator;
  readonly #proposals: DebugProposalService;
  readonly #controller: DebugSessionController;

  public constructor(
    private readonly configurations: RunConfigurationRepository,
    private readonly sessions: DebugSessionRepository,
    breakpoints: DebugBreakpointRepository,
    private readonly watches: DebugWatchRepository,
    private readonly workspaces: WorkspaceService,
    private readonly secretStore: SecretStore,
    private readonly adapters: DebugAdapterRegistry,
    private readonly audit?: AuditLogService,
  ) {
    this.#breakpointCoordinator = new DebugBreakpointCoordinator({
      repository: breakpoints,
      workspaces,
      activeAdapter: (workspaceId) => this.activeForWorkspace(workspaceId)?.adapter,
      emit: (event) => this.emit(event),
    });
    this.#proposals = new DebugProposalService({
      configurations,
      sessions,
      workspaces,
      ...(audit === undefined ? {} : { audit }),
      emit: (event) => this.emit(event),
    });
    this.#controller = new DebugSessionController({
      sessions,
      activeAdapter: (sessionId) => this.requireActiveSession(sessionId).adapter,
      emitStatus: (previous, session) => this.emitStatus(previous, session),
    });
  }

  public subscribe(listener: DebugListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public listHistory(input: ListDebugHistoryRequest): ReadonlyArray<DebugSession> {
    return this.sessions.list(input.workspaceId, input.limit);
  }

  public async proposeStart(input: ProposeDebugStartRequest): Promise<DebugSession> {
    return this.#proposals.propose(input);
  }

  public decideStart(input: DecideDebugStartRequest): Promise<DebugSession> {
    return this.enqueue(input.sessionId, async () => {
      const session = this.requireSession(input.sessionId);
      if (session.status !== 'pending_approval') throw new Error('调试请求已不再等待批准。');
      if (session.approvalDigest !== input.expectedApprovalDigest) {
        throw new Error('调试配置已变化，请重新审核。');
      }
      if (input.decision === 'reject') {
        const rejected = this.sessions.update(session.id, {
          status: 'rejected',
          approvalDecision: 'reject',
          approvalDecidedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        this.emitStatus(session, rejected);
        recordDebugSessionAudit(this.audit, rejected, 'denied');
        return rejected;
      }
      return this.startApproved(session);
    });
  }

  public stop(sessionId: string): Promise<DebugSession> {
    return this.enqueue(sessionId, async () => {
      const current = this.requireSession(sessionId);
      if (['stopped', 'completed', 'failed', 'rejected'].includes(current.status)) return current;
      if (current.status === 'pending_approval') {
        const rejected = this.sessions.update(sessionId, {
          status: 'rejected',
          approvalDecision: 'reject',
          approvalDecidedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        this.emitStatus(current, rejected);
        recordDebugSessionAudit(this.audit, rejected, 'cancelled');
        return rejected;
      }
      const stopping = this.sessions.update(sessionId, { status: 'stopping', pause: null });
      this.emitStatus(current, stopping);
      const active = this.#active.get(sessionId);
      if (active !== undefined) {
        active.terminating = true;
        await active.adapter.disconnect();
        active.unsubscribe();
        this.#active.delete(sessionId);
      }
      const stopped = this.sessions.update(sessionId, {
        status: 'stopped',
        adapterProcessId: null,
        completedAt: new Date().toISOString(),
      });
      this.emitStatus(stopping, stopped);
      recordDebugSessionAudit(this.audit, stopped, 'cancelled');
      return stopped;
    });
  }

  public async restart(sessionId: string): Promise<DebugSession> {
    const current = this.requireActiveSession(sessionId);
    const previous = this.requireSession(sessionId);
    const starting = this.sessions.update(sessionId, { status: 'starting', pause: null });
    this.emitStatus(previous, starting);
    await current.adapter.restart();
    const running = this.sessions.update(sessionId, { status: 'running' });
    this.emitStatus(starting, running);
    return running;
  }

  public pause(sessionId: string, threadId: number): Promise<DebugSession> {
    return this.#controller.control(sessionId, threadId, 'pause');
  }

  public continue(sessionId: string, threadId: number): Promise<DebugSession> {
    return this.#controller.control(sessionId, threadId, 'continue');
  }

  public next(sessionId: string, threadId: number): Promise<DebugSession> {
    return this.#controller.control(sessionId, threadId, 'next');
  }

  public stepIn(sessionId: string, threadId: number): Promise<DebugSession> {
    return this.#controller.control(sessionId, threadId, 'stepIn');
  }

  public stepOut(sessionId: string, threadId: number): Promise<DebugSession> {
    return this.#controller.control(sessionId, threadId, 'stepOut');
  }

  public async runToCursor(input: RunToCursorRequest): Promise<DebugSession> {
    return this.#controller.runToCursor(input);
  }

  public listBreakpoints(input: ListDebugBreakpointsRequest): ReadonlyArray<DebugBreakpoint> {
    return this.#breakpointCoordinator.list(input);
  }

  public async saveBreakpoint(input: SaveDebugBreakpointRequest): Promise<DebugBreakpoint> {
    return this.#breakpointCoordinator.save(input);
  }

  public async deleteBreakpoint(input: DeleteDebugBreakpointRequest): Promise<boolean> {
    return this.#breakpointCoordinator.delete(input);
  }

  public threads(sessionId: string): Promise<ReadonlyArray<DebugThread>> {
    return this.requireActiveSession(sessionId).adapter.threads();
  }

  public stackTrace(sessionId: string, threadId: number): Promise<ReadonlyArray<DebugStackFrame>> {
    return this.requireActiveSession(sessionId).adapter.stackTrace(threadId);
  }

  public scopes(sessionId: string, frameId: number): Promise<ReadonlyArray<DebugScope>> {
    return this.requireActiveSession(sessionId).adapter.scopes(frameId);
  }

  public variables(sessionId: string, reference: number): Promise<ReadonlyArray<DebugVariable>> {
    return this.requireActiveSession(sessionId).adapter.variables(reference);
  }

  public evaluate(input: EvaluateDebugRequest): Promise<DebugEvaluationResult> {
    return this.requireActiveSession(input.sessionId).adapter.evaluate(
      input.expression,
      input.frameId,
      input.context,
    );
  }

  public listWatches(input: ListDebugWatchesRequest): ReadonlyArray<DebugWatchExpression> {
    return this.watches.list(input.workspaceId);
  }

  public saveWatch(input: SaveDebugWatchRequest): DebugWatchExpression {
    return this.watches.save({
      workspaceId: input.workspaceId,
      expression: input.expression,
      ...(input.id === undefined ? {} : { id: input.id }),
    });
  }

  public deleteWatch(input: DeleteDebugWatchRequest): boolean {
    return this.watches.delete(input.workspaceId, input.watchId);
  }

  public async close(): Promise<void> {
    await Promise.allSettled([...this.#active.keys()].map((sessionId) => this.stop(sessionId)));
    this.#listeners.clear();
  }

  private async startApproved(session: DebugSession): Promise<DebugSession> {
    const configuration = this.configurations.findStoredById(session.configurationId);
    if (
      configuration === null ||
      configuration.workspaceId !== session.workspaceId ||
      configuration.updatedAt !== session.command.configurationUpdatedAt
    ) {
      return this.fail(session, 'DEBUG_CONFIGURATION_CHANGED', '调试配置已变化，请重新发起调试。');
    }
    const starting = this.sessions.update(session.id, {
      status: 'starting',
      approvalDecision: 'approve',
      approvalDecidedAt: new Date().toISOString(),
    });
    this.emitStatus(session, starting);
    recordDebugSessionAudit(this.audit, starting, 'allowed');
    try {
      const workspace = await this.workspaces.getById(session.workspaceId);
      const environment = await resolveRunEnvironment(
        workspace.rootPath,
        configuration,
        this.secretStore,
        session.command.environmentFileDigest,
      );
      const adapter = await this.adapters.get(session.adapterType).createSession({
        sessionId: session.id,
        workspaceRoot: workspace.rootPath,
        command: session.command,
        environment: environment.values,
        sensitiveValues: environment.sensitiveValues,
        breakpoints: this.#breakpointCoordinator.listWorkspace(session.workspaceId),
      });
      const active: ActiveDebugSession = {
        adapter,
        terminating: false,
        unsubscribe: () => undefined,
      };
      this.#active.set(session.id, active);
      active.unsubscribe = adapter.subscribe((event) => {
        void this.enqueue(session.id, () => this.handleAdapterEvent(session.id, event));
      });
      const running = this.sessions.update(session.id, {
        status: 'running',
        adapterProcessId: adapter.processId,
        capabilities: adapter.capabilities,
        startedAt: new Date().toISOString(),
      });
      this.emitStatus(starting, running);
      recordDebugSessionAudit(this.audit, running, 'started');
      await this.#breakpointCoordinator.refreshAll(session.workspaceId);
      return running;
    } catch (error) {
      return this.fail(
        this.requireSession(session.id),
        'DEBUG_START_FAILED',
        `调试启动失败：${safeErrorMessage(error)}`,
      );
    }
  }

  private async handleAdapterEvent(sessionId: string, event: DebugAdapterEvent): Promise<void> {
    const result = await handleDebugAdapterEvent({
      sessionId,
      event,
      sessions: this.sessions,
      active: this.#active.get(sessionId),
      nextOutputSequence: () => {
        const sequence = this.#sequences.get(sessionId) ?? 0;
        this.#sequences.set(sessionId, sequence + 1);
        return sequence;
      },
      removeActive: () => this.#active.delete(sessionId),
      emit: (debugEvent) => this.emit(debugEvent),
      emitStatus: (previous, session) => this.emitStatus(previous, session),
      updateBreakpoint: (workspaceId, breakpointEvent) =>
        this.#breakpointCoordinator.updateFromAdapter(workspaceId, breakpointEvent),
    });
    if (result === 'completed') {
      const completed = this.requireSession(sessionId);
      recordDebugSessionAudit(this.audit, completed, 'succeeded');
    }
  }

  private activeForWorkspace(workspaceId: string): ActiveDebugSession | undefined {
    for (const [sessionId, active] of this.#active) {
      if (this.sessions.findById(sessionId)?.workspaceId === workspaceId) return active;
    }
    return undefined;
  }

  private fail(previous: DebugSession, code: string, message: string): DebugSession {
    const failed = this.sessions.update(previous.id, {
      status: 'failed',
      adapterProcessId: null,
      pause: null,
      error: { code, message, retryable: true },
      completedAt: new Date().toISOString(),
    });
    this.emitStatus(previous, failed);
    recordDebugSessionAudit(this.audit, failed, 'failed');
    return failed;
  }

  private requireSession(sessionId: string): DebugSession {
    const session = this.sessions.findById(sessionId);
    if (session === null) throw new Error('找不到调试会话。');
    return session;
  }

  private requireActiveSession(sessionId: string): ActiveDebugSession {
    const active = this.#active.get(sessionId);
    if (active === undefined) throw new Error('调试会话当前未运行。');
    return active;
  }

  private emitStatus(previous: DebugSession | undefined, session: DebugSession): void {
    this.emit({
      type: 'status',
      session,
      ...(previous === undefined ? {} : { previousStatus: previous.status }),
      occurredAt: new Date().toISOString(),
    });
  }

  private emit(event: DebugEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  private enqueue<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(sessionId, settled);
    void settled.then(() => {
      if (this.#queues.get(sessionId) === settled) this.#queues.delete(sessionId);
    });
    return result;
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : '调试器返回了无法识别的错误。';
}
