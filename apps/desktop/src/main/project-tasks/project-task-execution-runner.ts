import type { ProjectTaskEvent, ProjectTaskExecution, RunStatus } from '@open-code-desk/domain';

import type { AuditLogService } from '../audit/audit-log.service';
import { redactAuditText } from '../audit/audit-log.service';
import { resolveRunEnvironment, resolveRunWorkingDirectory } from '../run/run-execution-policy';
import type { RunProcessExitResult, RunProcessSupervisor } from '../run/run-process-supervisor';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import { recordProjectTaskExecutionAudit } from './project-task-execution-audit';
import { ProjectTaskExecutionServiceError } from './project-task-execution-errors';
import type { ProjectTaskExecutionRepository } from './project-task-execution.repository';
import type { ProjectTaskRepository } from './project-task.repository';

const terminalStatuses: ReadonlySet<RunStatus> = new Set([
  'stopped',
  'completed',
  'failed',
  'rejected',
]);

export function isTerminalProjectTaskStatus(status: RunStatus): boolean {
  return terminalStatuses.has(status);
}

interface ActiveStep {
  readonly executionId: string;
  readonly taskId: string;
  readonly processKey: string;
  readonly baselineOutputTail: string;
  readonly baselineOutputBytes: number;
  readonly baselineOutputTruncated: boolean;
}

export class ProjectTaskExecutionRunner {
  readonly #sequences = new Map<string, number>();
  readonly #activeSteps = new Map<string, ActiveStep>();
  readonly #unsubscribeSupervisor: () => void;

  public constructor(
    private readonly tasks: ProjectTaskRepository,
    private readonly executions: ProjectTaskExecutionRepository,
    private readonly workspaces: WorkspaceService,
    private readonly secretStore: SecretStore,
    private readonly supervisor: RunProcessSupervisor,
    private readonly emitStatus: (
      previous: ProjectTaskExecution | undefined,
      execution: ProjectTaskExecution,
    ) => void,
    private readonly emit: (event: ProjectTaskEvent) => void,
    private readonly audit?: AuditLogService,
  ) {
    this.#unsubscribeSupervisor = this.supervisor.subscribe((event) => {
      if (event.type === 'output') {
        this.handleOutput(event.executionId, event.stream, event.chunk, event.timestamp);
      }
    });
  }

  public async stopActive(executionId: string): Promise<void> {
    const active = [...this.#activeSteps.values()].find((step) => step.executionId === executionId);
    if (active !== undefined) await this.supervisor.stop(active.processKey);
  }

  public clearActive(executionId: string): void {
    for (const [processKey, active] of this.#activeSteps) {
      if (active.executionId === executionId) this.#activeSteps.delete(processKey);
    }
  }

  public dispose(): void {
    this.#unsubscribeSupervisor();
  }

  public async execute(initial: ProjectTaskExecution): Promise<void> {
    const workspace = await this.workspaces.getById(initial.workspaceId);
    for (const [index, step] of initial.plan.entries()) {
      let current = this.requireExecution(initial.id);
      if (current.status === 'stopping') {
        this.finalizeStopped(current);
        return;
      }
      if (isTerminalProjectTaskStatus(current.status)) return;
      const task = this.tasks.findStoredById(step.taskId);
      if (
        task === null ||
        task.workspaceId !== initial.workspaceId ||
        task.updatedAt !== step.taskUpdatedAt
      ) {
        this.failExecution(
          current,
          'PROJECT_TASK_CHANGED',
          `任务“${step.taskName}”在执行前已变化，请重新发起执行。`,
          true,
        );
        return;
      }
      const cwd = await resolveRunWorkingDirectory(workspace.rootPath, step.workingDirectory);
      const environment = await resolveRunEnvironment(workspace.rootPath, task, this.secretStore);
      const processKey = `${initial.id}:${index}:${step.taskId}`;
      const activeStep: ActiveStep = {
        executionId: initial.id,
        taskId: step.taskId,
        processKey,
        baselineOutputTail: current.outputTail,
        baselineOutputBytes: current.outputBytes,
        baselineOutputTruncated: current.outputTruncated,
      };
      this.#activeSteps.set(processKey, activeStep);
      const process = await this.supervisor.start({
        executionId: processKey,
        executable: step.executable,
        args: step.args,
        cwd,
        resolvedEnvironment: environment.values,
        sensitiveValues: environment.sensitiveValues,
      });
      current = this.requireExecution(initial.id);
      const running = this.executions.update(initial.id, {
        status: 'running',
        currentTaskId: step.taskId,
        currentTaskIndex: index,
        processId: process.pid,
        ...(current.startedAt === undefined ? { startedAt: process.startedAt } : {}),
      });
      this.emitStatus(current, running);
      if (index === 0) recordProjectTaskExecutionAudit(this.audit, running, 'started');

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void this.supervisor.stop(processKey);
      }, step.timeoutMs);
      timeout.unref();
      const result = await this.supervisor.waitForExit(processKey);
      clearTimeout(timeout);
      this.#activeSteps.delete(processKey);
      current = this.applyStepResult(this.requireExecution(initial.id), activeStep, result);
      if (current.status === 'stopping') {
        this.finalizeStopped(current, result);
        return;
      }
      if (timedOut) {
        this.failExecution(
          current,
          'PROJECT_TASK_TIMEOUT',
          `任务“${step.taskName}”超过 ${step.timeoutMs} ms 超时限制。`,
          true,
          result,
        );
        return;
      }
      if (result.status !== 'completed') {
        this.failExecution(
          current,
          'PROJECT_TASK_STEP_FAILED',
          `任务“${step.taskName}”执行失败${result.exitCode === null ? '' : `，退出码 ${result.exitCode}`}。`,
          true,
          result,
        );
        return;
      }
    }
    const current = this.requireExecution(initial.id);
    if (current.status === 'stopping') {
      this.finalizeStopped(current);
      return;
    }
    const completed = this.executions.update(initial.id, {
      status: 'completed',
      currentTaskId: null,
      currentTaskIndex: null,
      processId: null,
      exitCode: 0,
      completedAt: new Date().toISOString(),
    });
    this.emitStatus(current, completed);
    recordProjectTaskExecutionAudit(this.audit, completed, 'succeeded');
  }

  public failExecution(
    previous: ProjectTaskExecution,
    code: string,
    message: string,
    retryable: boolean,
    result?: RunProcessExitResult,
  ): ProjectTaskExecution {
    const failed = this.executions.update(previous.id, {
      status: 'failed',
      ...(previous.status === 'pending_approval'
        ? {
            approvalDecision: 'approve' as const,
            approvalDecidedAt: new Date().toISOString(),
          }
        : {}),
      processId: null,
      ...(result === undefined
        ? {}
        : { exitCode: result.exitCode, terminationSignal: result.signal }),
      error: { code, message: redactAuditText(message).slice(0, 2_000), retryable },
      completedAt: result?.finishedAt ?? new Date().toISOString(),
    });
    this.emitStatus(previous, failed);
    recordProjectTaskExecutionAudit(this.audit, failed, 'failed');
    return failed;
  }

  public finalizeStopped(
    previous: ProjectTaskExecution,
    result?: RunProcessExitResult,
  ): ProjectTaskExecution {
    const stopped = this.executions.update(previous.id, {
      status: 'stopped',
      processId: null,
      ...(result === undefined
        ? {}
        : { exitCode: result.exitCode, terminationSignal: result.signal }),
      completedAt: result?.finishedAt ?? new Date().toISOString(),
    });
    this.emitStatus(previous, stopped);
    recordProjectTaskExecutionAudit(this.audit, stopped, 'cancelled');
    return stopped;
  }

  private handleOutput(
    processKey: string,
    stream: 'stdout' | 'stderr',
    chunk: string,
    occurredAt: string,
  ): void {
    const active = this.#activeSteps.get(processKey);
    if (active === undefined) return;
    const current = this.executions.findById(active.executionId);
    if (current === null || isTerminalProjectTaskStatus(current.status)) return;
    const updated = this.executions.update(current.id, {
      outputTail: appendOutputTail(current.outputTail, chunk),
      outputBytes: current.outputBytes + Buffer.byteLength(chunk),
      outputTruncated: current.outputTruncated,
    });
    const sequence = this.#sequences.get(current.id) ?? 0;
    this.#sequences.set(current.id, sequence + 1);
    this.emit({
      type: 'output',
      executionId: current.id,
      workspaceId: current.workspaceId,
      taskId: active.taskId,
      stream,
      sequence,
      data: chunk,
      occurredAt,
    });
    if (updated.outputTail.length === 0) return;
  }

  private applyStepResult(
    current: ProjectTaskExecution,
    active: ActiveStep,
    result: RunProcessExitResult,
  ): ProjectTaskExecution {
    return this.executions.update(current.id, {
      processId: null,
      outputTail: appendOutputTail(active.baselineOutputTail, result.outputTail),
      outputBytes: active.baselineOutputBytes + result.outputBytes,
      outputTruncated: active.baselineOutputTruncated || result.outputTruncated,
      exitCode: result.exitCode,
      terminationSignal: result.signal,
    });
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
}

function appendOutputTail(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  return combined.length <= 65_536 ? combined : combined.slice(-65_536);
}

export function safeProjectTaskErrorMessage(error: unknown): string {
  if (error instanceof Error) return redactAuditText(error.message).slice(0, 2_000);
  return '任务进程返回了无法识别的错误。';
}
