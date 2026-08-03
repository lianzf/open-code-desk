import type {
  DebugEvaluationResult,
  DebugEvent,
  DebugScope,
  DebugSession,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  DebugWatchExpression,
  ProjectTaskPlanSnapshot,
} from '@open-code-desk/domain';
import type {
  DecideDebugStartRequest,
  EvaluateDebugRequest,
  ListDebugHistoryRequest,
  ListDebugWatchesRequest,
  ProposeDebugStartRequest,
  RunToCursorRequest,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import type { ProjectTaskExecutionService } from '../project-tasks/project-task-execution.service';
import type { RunConfigurationRepository } from '../run/run-configuration.repository';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { DebugAdapterEvent } from './debug-adapter';
import type { DebugAdapterRegistry } from './debug-adapter.registry';
import { handleDebugAdapterEvent, type ActiveDebugSession } from './debug-adapter-event-handler';
import type { DebugBreakpointRepository } from './debug-breakpoint.repository';
import { DebugConfigurationCoordinator } from './debug-configuration-coordinator';
import { DebugOperationQueue } from './debug-operation-queue';
import { DebugProposalService } from './debug-proposal.service';
import { recordDebugSessionAudit } from './debug-session-audit';
import { DebugSessionController } from './debug-session-controller';
import { DebugSessionStartup, safeErrorMessage } from './debug-session-startup';
import type { DebugSessionRepository } from './debug-session.repository';
import type { DebugSettingsRepository } from './debug-settings.repository';
import type { DebugWatchRepository } from './debug-watch.repository';

type DebugListener = (event: DebugEvent) => void;

export class DebugSessionService {
  readonly #active = new Map<string, ActiveDebugSession>();
  readonly #listeners = new Set<DebugListener>();
  readonly #operations = new DebugOperationQueue();
  readonly #sequences = new Map<string, number>();
  readonly #startupRunners = new Map<string, Promise<void>>();
  readonly #activeHookExecutionIds = new Map<string, string>();
  readonly #proposals: DebugProposalService;
  readonly #controller: DebugSessionController;
  readonly #startup: DebugSessionStartup;
  #closing = false;
  public readonly configuration: DebugConfigurationCoordinator;

  public constructor(
    private readonly configurations: RunConfigurationRepository,
    private readonly sessions: DebugSessionRepository,
    breakpoints: DebugBreakpointRepository,
    debugSettings: DebugSettingsRepository,
    watches: DebugWatchRepository,
    private readonly workspaces: WorkspaceService,
    private readonly secretStore: SecretStore,
    private readonly adapters: DebugAdapterRegistry,
    private readonly audit?: AuditLogService,
    private readonly taskExecutions?: ProjectTaskExecutionService,
  ) {
    this.configuration = new DebugConfigurationCoordinator({
      breakpoints,
      settings: debugSettings,
      watches,
      workspaces,
      activeAdapter: (workspaceId) => this.activeForWorkspace(workspaceId)?.adapter,
      emit: (event) => this.emit(event),
    });
    this.#proposals = new DebugProposalService({
      configurations,
      sessions,
      workspaces,
      ...(audit === undefined ? {} : { audit }),
      ...(taskExecutions === undefined ? {} : { taskPlans: taskExecutions }),
      emit: (event) => this.emit(event),
    });
    this.#controller = new DebugSessionController({
      sessions,
      activeAdapter: (sessionId) => this.requireActiveSession(sessionId).adapter,
      emitStatus: (previous, session) => this.emitStatus(previous, session),
    });
    this.#startup = new DebugSessionStartup({
      configurations,
      sessions,
      workspaces,
      secretStore,
      adapters,
      configuration: this.configuration,
      active: this.#active,
      runners: this.#startupRunners,
      ...(audit === undefined ? {} : { audit }),
      executeHook: (session, phase) => {
        const snapshot =
          phase === 'pre' ? session.command.preLaunchTaskPlan : session.command.postRunTaskPlan;
        if (snapshot === undefined) throw new Error('调试任务快照不存在。');
        return this.executeHook(session, snapshot);
      },
      fail: (previous, code, message) => this.fail(previous, code, message),
      emitStatus: (previous, session) => this.emitStatus(previous, session),
      onAdapterEvent: (sessionId, event) => {
        void this.enqueue(sessionId, () => this.handleAdapterEvent(sessionId, event));
      },
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
      return this.#startup.startApproved(session);
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
      const hookExecutionId = this.#activeHookExecutionIds.get(sessionId);
      if (hookExecutionId !== undefined && this.taskExecutions !== undefined) {
        await this.taskExecutions.stop({ executionId: hookExecutionId });
      }
      await this.#startupRunners.get(sessionId);
      const active = this.#active.get(sessionId);
      if (active !== undefined) {
        active.terminating = true;
        await active.adapter.disconnect();
        active.unsubscribe();
        this.#active.delete(sessionId);
      }
      const beforePostTask = this.requireSession(sessionId);
      if (
        beforePostTask.startedAt !== undefined &&
        beforePostTask.command.postRunTaskPlan !== undefined &&
        !this.#closing
      ) {
        const taskExecution = await this.executeHook(
          beforePostTask,
          beforePostTask.command.postRunTaskPlan,
        );
        if (taskExecution.status !== 'completed') {
          return this.fail(
            this.requireSession(sessionId),
            'DEBUG_POST_TASK_FAILED',
            `调试后任务执行失败：${taskExecution.error?.message ?? taskExecution.status}`,
          );
        }
      }
      const beforeStopped = this.requireSession(sessionId);
      const stopped = this.sessions.update(sessionId, {
        status: 'stopped',
        adapterProcessId: null,
        completedAt: new Date().toISOString(),
      });
      this.emitStatus(beforeStopped, stopped);
      recordDebugSessionAudit(this.audit, stopped, 'cancelled');
      return stopped;
    });
  }

  public restart(sessionId: string): Promise<DebugSession> {
    return this.enqueue(sessionId, async () => {
      const previous = this.requireSession(sessionId);
      if (!['running', 'paused'].includes(previous.status)) {
        throw new Error('只有正在运行或暂停的调试会话可以重新启动。');
      }
      const current = this.requireActiveSession(sessionId);
      current.terminating = true;
      current.unsubscribe();
      this.#active.delete(sessionId);
      try {
        await current.adapter.disconnect();
      } catch (error) {
        return this.fail(
          previous,
          'DEBUG_RESTART_FAILED',
          `重新调试失败：${safeErrorMessage(error)}`,
        );
      }
      return this.#startup.startApproved(this.requireSession(sessionId));
    });
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
    return this.configuration.watches.list(input);
  }

  public async close(): Promise<void> {
    this.#closing = true;
    const sessionIds = new Set([...this.#active.keys(), ...this.#startupRunners.keys()]);
    await Promise.allSettled([...sessionIds].map((sessionId) => this.stop(sessionId)));
    await Promise.allSettled(this.#startupRunners.values());
    this.#listeners.clear();
  }

  private async executeHook(parent: DebugSession, snapshot: ProjectTaskPlanSnapshot) {
    if (this.taskExecutions === undefined) throw new Error('项目任务执行器不可用。');
    try {
      return await this.taskExecutions.executeApprovedPlan({
        workspaceId: parent.workspaceId,
        snapshot,
        parentApprovalDigest: parent.approvalDigest,
        onStarted: (execution) => {
          this.#activeHookExecutionIds.set(parent.id, execution.id);
        },
      });
    } finally {
      this.#activeHookExecutionIds.delete(parent.id);
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
        this.configuration.updateBreakpointFromAdapter(workspaceId, breakpointEvent),
    });
    if (result === 'completed') {
      let completed = this.requireSession(sessionId);
      if (completed.command.postRunTaskPlan !== undefined && !this.#closing) {
        const taskExecution = await this.executeHook(completed, completed.command.postRunTaskPlan);
        if (taskExecution.status !== 'completed') {
          this.fail(
            completed,
            'DEBUG_POST_TASK_FAILED',
            `调试后任务执行失败：${taskExecution.error?.message ?? taskExecution.status}`,
          );
          return;
        }
        completed = this.requireSession(sessionId);
      }
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
    return this.#operations.enqueue(sessionId, action);
  }
}
