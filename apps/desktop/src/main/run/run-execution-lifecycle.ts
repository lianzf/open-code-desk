import type { RunExecution, RunStatus } from '@open-code-desk/domain';

import type { AuditLogService } from '../audit/audit-log.service';
import { redactAuditText } from '../audit/audit-log.service';
import type { ProjectTaskExecutionService } from '../project-tasks/project-task-execution.service';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { RunConfigurationRepository } from './run-configuration.repository';
import { recordRunExecutionAudit } from './run-execution-audit';
import { RunExecutionServiceError } from './run-execution-errors';
import { resolveRunEnvironment, resolveRunWorkingDirectory } from './run-execution-policy';
import type { RunExecutionRepository } from './run-execution.repository';
import type { RunPortService } from './run-port.service';
import type { RunProcessExitResult, RunProcessSupervisor } from './run-process-supervisor';

type StoredRunConfiguration = NonNullable<ReturnType<RunConfigurationRepository['findStoredById']>>;

const terminalStatuses: ReadonlySet<RunStatus> = new Set([
  'stopped',
  'completed',
  'failed',
  'rejected',
]);

export function isTerminalRunStatus(status: RunStatus): boolean {
  return terminalStatuses.has(status);
}

export class RunExecutionLifecycle {
  readonly #activeHookExecutionIds = new Map<string, string>();

  public constructor(
    private readonly executions: RunExecutionRepository,
    private readonly workspaces: WorkspaceService,
    private readonly secretStore: SecretStore,
    private readonly supervisor: RunProcessSupervisor,
    private readonly ports: RunPortService,
    private readonly emitStatus: (
      previous: RunExecution | undefined,
      execution: RunExecution,
    ) => void,
    private readonly isClosing: () => boolean,
    private readonly audit?: AuditLogService,
    private readonly taskExecutions?: ProjectTaskExecutionService,
  ) {}

  public async stopActiveHook(parentExecutionId: string): Promise<void> {
    const hookExecutionId = this.#activeHookExecutionIds.get(parentExecutionId);
    if (hookExecutionId !== undefined && this.taskExecutions !== undefined) {
      await this.taskExecutions.stop({ executionId: hookExecutionId });
    }
  }

  public async execute(
    initial: RunExecution,
    configuration: StoredRunConfiguration,
  ): Promise<void> {
    if (!(await this.checkPortAvailable(initial))) return;
    if (!(await this.executePreLaunchTask(initial))) return;

    let current = this.requireExecution(initial.id);
    if (current.status === 'stopping') {
      this.finalizeBeforeStartStopped(current);
      return;
    }
    const workspace = await this.workspaces.getById(initial.workspaceId);
    const cwd = await resolveRunWorkingDirectory(
      workspace.rootPath,
      initial.command.workingDirectory,
    );
    const environment = await resolveRunEnvironment(
      workspace.rootPath,
      configuration,
      this.secretStore,
      initial.command.environmentFileDigest,
    );
    const process = await this.supervisor.start({
      executionId: initial.id,
      executable: initial.command.executable,
      args: [...initial.command.runtimeArgs, ...initial.command.args],
      cwd,
      resolvedEnvironment: environment.values,
      sensitiveValues: environment.sensitiveValues,
      ...(initial.command.port === undefined ? {} : { port: initial.command.port }),
    });
    current = this.requireExecution(initial.id);
    if (current.status === 'stopping') {
      await this.supervisor.stop(initial.id);
    } else {
      const running = this.executions.update(initial.id, {
        status: 'running',
        processId: process.pid,
        startedAt: process.startedAt,
      });
      this.emitStatus(current, running);
      recordRunExecutionAudit(this.audit, running, 'started');
    }
    const result = await this.supervisor.waitForExit(initial.id);
    if (!(await this.executePostRunTask(initial, result))) return;
    this.finalizeExit(this.requireExecution(initial.id), result);
  }

  public failApprovedExecution(
    previous: RunExecution,
    code: string,
    message: string,
    retryable: boolean,
  ): RunExecution {
    const failed = this.executions.update(previous.id, {
      status: 'failed',
      approvalDecision: 'approve',
      approvalDecidedAt: previous.approvalDecidedAt ?? new Date().toISOString(),
      processId: null,
      error: { code, message: redactAuditText(message), retryable },
      completedAt: new Date().toISOString(),
    });
    this.emitStatus(previous, failed);
    recordRunExecutionAudit(this.audit, failed, 'failed');
    return failed;
  }

  private async checkPortAvailable(initial: RunExecution): Promise<boolean> {
    if (initial.command.port === undefined) return true;
    const inspection = await this.ports.inspect(initial.command.port);
    if (inspection.available) return true;
    const owner =
      inspection.processId === undefined
        ? '无法识别占用进程'
        : `${inspection.processName ?? '进程'} (PID ${inspection.processId})`;
    this.failApprovedExecution(
      initial,
      'RUN_PORT_CONFLICT',
      `端口 ${initial.command.port} 已被 ${owner} 占用，请更换端口或确认后终止占用进程。`,
      true,
    );
    return false;
  }

  private async executePreLaunchTask(initial: RunExecution): Promise<boolean> {
    if (initial.command.preLaunchTaskPlan === undefined) return true;
    const taskExecution = await this.executeHook(initial, initial.command.preLaunchTaskPlan);
    const current = this.requireExecution(initial.id);
    if (current.status === 'stopping') {
      this.finalizeBeforeStartStopped(current);
      return false;
    }
    if (taskExecution.status === 'completed') return true;
    this.failApprovedExecution(
      current,
      'RUN_PRE_LAUNCH_TASK_FAILED',
      `启动前任务执行失败：${taskExecution.error?.message ?? taskExecution.status}`,
      true,
    );
    return false;
  }

  private async executePostRunTask(
    initial: RunExecution,
    result: RunProcessExitResult,
  ): Promise<boolean> {
    if (initial.command.postRunTaskPlan === undefined || this.isClosing()) return true;
    const current = this.requireExecution(initial.id);
    const finalizing = this.executions.update(initial.id, {
      status: 'stopping',
      processId: null,
      outputTail: result.outputTail,
      outputBytes: result.outputBytes,
      outputTruncated: result.outputTruncated,
    });
    this.emitStatus(current, finalizing);
    const taskExecution = await this.executeHook(initial, initial.command.postRunTaskPlan);
    if (taskExecution.status === 'completed') return true;
    this.failApprovedExecution(
      this.requireExecution(initial.id),
      'RUN_POST_TASK_FAILED',
      `启动后任务执行失败：${taskExecution.error?.message ?? taskExecution.status}`,
      true,
    );
    return false;
  }

  private async executeHook(
    parent: RunExecution,
    snapshot: NonNullable<RunExecution['command']['preLaunchTaskPlan']>,
  ) {
    if (this.taskExecutions === undefined) {
      throw new RunExecutionServiceError(
        'RUN_TASK_EXECUTOR_MISSING',
        '项目任务执行器不可用。',
        true,
      );
    }
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

  private finalizeBeforeStartStopped(previous: RunExecution): RunExecution {
    const stopped = this.executions.update(previous.id, {
      status: 'stopped',
      processId: null,
      completedAt: new Date().toISOString(),
    });
    this.emitStatus(previous, stopped);
    recordRunExecutionAudit(this.audit, stopped, 'cancelled');
    return stopped;
  }

  private finalizeExit(previous: RunExecution, result: RunProcessExitResult): RunExecution {
    const current = this.requireExecution(previous.id);
    if (isTerminalRunStatus(current.status)) return current;
    const updated = this.executions.update(current.id, {
      status: result.status,
      processId: null,
      outputTail: result.outputTail,
      outputBytes: result.outputBytes,
      outputTruncated: result.outputTruncated,
      exitCode: result.exitCode,
      terminationSignal: result.signal,
      error:
        result.errorMessage === undefined
          ? null
          : {
              code: 'RUN_PROCESS_FAILED',
              message: safeRunErrorMessage(result.errorMessage),
              retryable: true,
            },
      completedAt: result.finishedAt,
    });
    this.emitStatus(current, updated);
    recordRunExecutionAudit(
      this.audit,
      updated,
      result.status === 'completed'
        ? 'succeeded'
        : result.status === 'stopped'
          ? 'cancelled'
          : 'failed',
    );
    return updated;
  }

  private requireExecution(executionId: string): RunExecution {
    const execution = this.executions.findById(executionId);
    if (execution === null) {
      throw new RunExecutionServiceError('RUN_NOT_FOUND', '找不到运行记录。');
    }
    return execution;
  }
}

export function safeRunErrorMessage(error: unknown): string {
  if (error instanceof RunExecutionServiceError) return redactAuditText(error.message);
  if (error instanceof Error) return redactAuditText(error.message).slice(0, 2_000);
  return '运行进程返回了无法识别的错误。';
}
