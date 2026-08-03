import { createHash, randomUUID } from 'node:crypto';

import type {
  ProjectTaskEvent,
  ProjectTaskExecution,
  ProjectTaskPlanSnapshot,
} from '@open-code-desk/domain';
import type {
  DecideProjectTaskStartRequest,
  ListProjectTaskHistoryRequest,
  ProjectTaskExecutionIdRequest,
  ProposeProjectTaskStartRequest,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import { RunProcessSupervisor } from '../run/run-process-supervisor';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import { recordProjectTaskExecutionAudit } from './project-task-execution-audit';
import { ProjectTaskExecutionServiceError } from './project-task-execution-errors';
import {
  isTerminalProjectTaskStatus,
  ProjectTaskExecutionRunner,
  safeProjectTaskErrorMessage,
} from './project-task-execution-runner';
import type { ProjectTaskExecutionRepository } from './project-task-execution.repository';
import { ProjectTaskPlanBuilder } from './project-task-plan-builder';
import type { ProjectTaskRepository } from './project-task.repository';

type ProjectTaskEventListener = (event: ProjectTaskEvent) => void;

export { ProjectTaskExecutionServiceError } from './project-task-execution-errors';

export class ProjectTaskExecutionService {
  readonly #listeners = new Set<ProjectTaskEventListener>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #runners = new Map<string, Promise<void>>();
  readonly #planBuilder: ProjectTaskPlanBuilder;
  readonly #runner: ProjectTaskExecutionRunner;

  public constructor(
    private readonly tasks: ProjectTaskRepository,
    private readonly executions: ProjectTaskExecutionRepository,
    private readonly workspaces: WorkspaceService,
    private readonly secretStore: SecretStore,
    private readonly supervisor: RunProcessSupervisor = new RunProcessSupervisor(),
    private readonly audit?: AuditLogService,
  ) {
    this.#planBuilder = new ProjectTaskPlanBuilder(this.tasks, this.workspaces);
    this.#runner = new ProjectTaskExecutionRunner(
      this.tasks,
      this.executions,
      this.workspaces,
      this.secretStore,
      this.supervisor,
      (previous, execution) => this.emitStatus(previous, execution),
      (event) => this.emit(event),
      this.audit,
    );
  }

  public subscribe(listener: ProjectTaskEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public listHistory(input: ListProjectTaskHistoryRequest): ReadonlyArray<ProjectTaskExecution> {
    return this.executions.list(input.workspaceId, input.taskId, input.limit);
  }

  public proposeStart(input: ProposeProjectTaskStartRequest): Promise<ProjectTaskExecution> {
    return this.createProposal(input.workspaceId, input.taskId);
  }

  public decideStart(input: DecideProjectTaskStartRequest): Promise<ProjectTaskExecution> {
    return this.enqueue(input.executionId, async () => {
      const execution = this.requireExecution(input.executionId);
      if (execution.status !== 'pending_approval') {
        throw new ProjectTaskExecutionServiceError(
          'PROJECT_TASK_NOT_PENDING',
          '该任务执行请求已不再等待批准。',
        );
      }
      if (execution.approvalDigest !== input.expectedApprovalDigest) {
        throw new ProjectTaskExecutionServiceError(
          'PROJECT_TASK_APPROVAL_STALE',
          '任务执行计划已变化，请重新审核。',
          true,
        );
      }
      if (input.decision === 'reject') {
        const rejected = this.executions.update(execution.id, {
          status: 'rejected',
          approvalDecision: 'reject',
          approvalDecidedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        this.emitStatus(execution, rejected);
        recordProjectTaskExecutionAudit(this.audit, rejected, 'denied');
        return rejected;
      }
      return this.approveAndStart(execution);
    });
  }

  public stop(input: ProjectTaskExecutionIdRequest): Promise<ProjectTaskExecution> {
    return this.enqueue(input.executionId, async () => {
      const execution = this.requireExecution(input.executionId);
      if (isTerminalProjectTaskStatus(execution.status)) return execution;
      if (execution.status === 'pending_approval') {
        const rejected = this.executions.update(execution.id, {
          status: 'rejected',
          approvalDecision: 'reject',
          approvalDecidedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        this.emitStatus(execution, rejected);
        recordProjectTaskExecutionAudit(this.audit, rejected, 'cancelled');
        return rejected;
      }

      const stopping =
        execution.status === 'stopping'
          ? execution
          : this.executions.update(execution.id, { status: 'stopping' });
      if (stopping !== execution) this.emitStatus(execution, stopping);
      await this.#runner.stopActive(execution.id);
      await this.#runners.get(execution.id);
      const current = this.requireExecution(execution.id);
      return isTerminalProjectTaskStatus(current.status)
        ? current
        : this.#runner.finalizeStopped(current);
    });
  }

  public async restart(input: ProjectTaskExecutionIdRequest): Promise<ProjectTaskExecution> {
    const original = this.requireExecution(input.executionId);
    if (!isTerminalProjectTaskStatus(original.status)) {
      await this.stop({ executionId: original.id });
    }
    return this.createProposal(original.workspaceId, original.rootTaskId, original.id);
  }

  /** Builds the exact immutable task plan that a parent run/debug approval must display. */
  public preparePlan(workspaceId: string, rootTaskId: string): Promise<ProjectTaskPlanSnapshot> {
    return this.#planBuilder.prepare(workspaceId, rootTaskId);
  }

  /** Executes a plan already covered by a parent run/debug approval digest. */
  public async executeApprovedPlan(input: {
    readonly workspaceId: string;
    readonly snapshot: ProjectTaskPlanSnapshot;
    readonly parentApprovalDigest: string;
    readonly onStarted?: (execution: ProjectTaskExecution) => void;
  }): Promise<ProjectTaskExecution> {
    const executionId = randomUUID();
    const execution = this.executions.create({
      id: executionId,
      workspaceId: input.workspaceId,
      rootTaskId: input.snapshot.rootTaskId,
      plan: input.snapshot.plan,
      riskLevel: input.snapshot.riskLevel,
      riskReasons: input.snapshot.riskReasons,
      approvalDigest: createHash('sha256')
        .update(
          JSON.stringify({
            version: 1,
            purpose: 'approved-parent-hook',
            executionId,
            workspaceId: input.workspaceId,
            parentApprovalDigest: input.parentApprovalDigest,
            snapshot: input.snapshot,
          }),
        )
        .digest('hex'),
    });
    this.emitStatus(undefined, execution);
    recordProjectTaskExecutionAudit(this.audit, execution, 'requested');
    const starting = this.approveAndStart(execution);
    if (isTerminalProjectTaskStatus(starting.status)) return starting;
    input.onStarted?.(starting);
    await this.#runners.get(starting.id);
    return this.requireExecution(starting.id);
  }

  public async close(): Promise<void> {
    await this.supervisor.closeAll();
    await Promise.allSettled(this.#runners.values());
    await Promise.allSettled(this.#queues.values());
    this.#runner.dispose();
    this.#listeners.clear();
  }

  private async createProposal(
    workspaceId: string,
    rootTaskId: string,
    restartOfExecutionId?: string,
  ): Promise<ProjectTaskExecution> {
    const snapshot = await this.preparePlan(workspaceId, rootTaskId);
    const executionId = randomUUID();
    const approvalDigest = createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          executionId,
          workspaceId,
          rootTaskId,
          plan: snapshot.plan,
          riskLevel: snapshot.riskLevel,
          riskReasons: snapshot.riskReasons,
        }),
      )
      .digest('hex');
    const execution = this.executions.create({
      id: executionId,
      workspaceId,
      rootTaskId,
      ...(restartOfExecutionId === undefined ? {} : { restartOfExecutionId }),
      plan: snapshot.plan,
      riskLevel: snapshot.riskLevel,
      riskReasons: snapshot.riskReasons,
      approvalDigest,
    });
    this.emitStatus(undefined, execution);
    recordProjectTaskExecutionAudit(this.audit, execution, 'requested');
    return execution;
  }

  private approveAndStart(execution: ProjectTaskExecution): ProjectTaskExecution {
    const staleStep = execution.plan.find((step) => {
      const current = this.tasks.findStoredById(step.taskId);
      return (
        current === null ||
        current.workspaceId !== execution.workspaceId ||
        current.updatedAt !== step.taskUpdatedAt
      );
    });
    if (staleStep !== undefined) {
      return this.#runner.failExecution(
        execution,
        'PROJECT_TASK_CHANGED',
        `任务“${staleStep.taskName}”在批准前已变化，请重新发起执行。`,
        true,
      );
    }
    const starting = this.executions.update(execution.id, {
      status: 'starting',
      approvalDecision: 'approve',
      approvalDecidedAt: new Date().toISOString(),
    });
    this.emitStatus(execution, starting);
    recordProjectTaskExecutionAudit(this.audit, starting, 'allowed');
    const runner = this.#runner.execute(starting).catch((error: unknown) => {
      this.#runner.clearActive(starting.id);
      const current = this.requireExecution(starting.id);
      if (!isTerminalProjectTaskStatus(current.status)) {
        this.#runner.failExecution(
          current,
          'PROJECT_TASK_START_FAILED',
          `项目任务启动失败：${safeProjectTaskErrorMessage(error)}`,
          true,
        );
      }
    });
    this.#runners.set(starting.id, runner);
    void runner.finally(() => this.#runners.delete(starting.id));
    return starting;
  }

  private emitStatus(
    previous: ProjectTaskExecution | undefined,
    execution: ProjectTaskExecution,
  ): void {
    this.emit({
      type: 'status',
      execution,
      ...(previous === undefined ? {} : { previousStatus: previous.status }),
      occurredAt: new Date().toISOString(),
    });
  }

  private emit(event: ProjectTaskEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Renderer listeners are isolated from the task lifecycle.
      }
    }
  }

  private requireExecution(executionId: string): ProjectTaskExecution {
    const execution = this.executions.findById(executionId);
    if (execution === null) {
      throw new ProjectTaskExecutionServiceError(
        'PROJECT_TASK_EXECUTION_NOT_FOUND',
        '找不到项目任务执行记录。',
      );
    }
    return execution;
  }

  private enqueue<T>(executionId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(executionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(executionId, settled);
    void settled.then(() => {
      if (this.#queues.get(executionId) === settled) this.#queues.delete(executionId);
    });
    return result;
  }
}
