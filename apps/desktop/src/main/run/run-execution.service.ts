import type { RunEvent, RunExecution, RunStatus } from '@open-code-desk/domain';
import type {
  DecideRunStartRequest,
  ListRunHistoryRequest,
  ProposeRunStartRequest,
  RestartRunExecutionRequest,
  StopRunExecutionRequest,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import { redactAuditText } from '../audit/audit-log.service';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { RunConfigurationRepository } from './run-configuration.repository';
import { recordRunExecutionAudit } from './run-execution-audit';
import { RunExecutionServiceError } from './run-execution-errors';
import { resolveRunEnvironment, resolveRunWorkingDirectory } from './run-execution-policy';
import { createRunProposal } from './run-execution-proposal';
import type { RunExecutionRepository } from './run-execution.repository';
import {
  RunProcessSupervisor,
  type RunProcessEvent,
  type RunProcessExitResult,
} from './run-process-supervisor';

type RunEventListener = (event: RunEvent) => void;

export { RunExecutionServiceError } from './run-execution-errors';

const terminalStatuses: ReadonlySet<RunStatus> = new Set([
  'stopped',
  'completed',
  'failed',
  'rejected',
]);

export class RunExecutionService {
  readonly #listeners = new Set<RunEventListener>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #sequences = new Map<string, number>();
  readonly #unsubscribeSupervisor: () => void;

  public constructor(
    private readonly configurations: RunConfigurationRepository,
    private readonly executions: RunExecutionRepository,
    private readonly workspaces: WorkspaceService,
    private readonly secretStore: SecretStore,
    private readonly supervisor: RunProcessSupervisor = new RunProcessSupervisor(),
    private readonly audit?: AuditLogService,
  ) {
    this.#unsubscribeSupervisor = this.supervisor.subscribe((event) => {
      if (event.type !== 'started') {
        void this.enqueue(event.executionId, () => this.handleProcessEvent(event));
      }
    });
  }

  public subscribe(listener: RunEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public listHistory(input: ListRunHistoryRequest): ReadonlyArray<RunExecution> {
    return this.executions.list(input.workspaceId, {
      ...(input.configurationId === undefined ? {} : { configurationId: input.configurationId }),
      limit: input.limit,
    });
  }

  public proposeStart(input: ProposeRunStartRequest): Promise<RunExecution> {
    return this.createProposal(input.workspaceId, input.configurationId);
  }

  public decideStart(input: DecideRunStartRequest): Promise<RunExecution> {
    return this.enqueue(input.executionId, async () => {
      const execution = this.requireExecution(input.executionId);
      if (execution.status !== 'pending_approval') {
        throw new RunExecutionServiceError('RUN_NOT_PENDING', '该运行请求已不再等待批准。');
      }
      if (execution.approvalDigest !== input.expectedApprovalDigest) {
        throw new RunExecutionServiceError(
          'RUN_APPROVAL_STALE',
          '运行命令或配置已变化，请重新审核。',
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
        recordRunExecutionAudit(this.audit, rejected, 'denied');
        return rejected;
      }
      return this.approveAndStart(execution);
    });
  }

  public stop(input: StopRunExecutionRequest): Promise<RunExecution> {
    return this.enqueue(input.executionId, async () => {
      const execution = this.requireExecution(input.executionId);
      if (terminalStatuses.has(execution.status)) {
        return execution;
      }
      if (execution.status === 'pending_approval') {
        const rejected = this.executions.update(execution.id, {
          status: 'rejected',
          approvalDecision: 'reject',
          approvalDecidedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        this.emitStatus(execution, rejected);
        recordRunExecutionAudit(this.audit, rejected, 'cancelled');
        return rejected;
      }

      const stopping =
        execution.status === 'stopping'
          ? execution
          : this.executions.update(execution.id, { status: 'stopping' });
      if (stopping !== execution) {
        this.emitStatus(execution, stopping);
      }
      const stopped = await this.supervisor.stop(execution.id);
      if (!stopped) {
        return this.finalizeMissingProcess(stopping);
      }
      return this.finalizeExit(stopping, await this.supervisor.waitForExit(execution.id));
    });
  }

  public async restart(input: RestartRunExecutionRequest): Promise<RunExecution> {
    const original = this.requireExecution(input.executionId);
    if (!terminalStatuses.has(original.status)) {
      await this.stop({ executionId: original.id });
    }
    return this.createProposal(original.workspaceId, original.configurationId, original.id);
  }

  public async close(): Promise<void> {
    await this.supervisor.closeAll();
    await Promise.allSettled(this.#queues.values());
    this.#unsubscribeSupervisor();
    this.#listeners.clear();
  }

  private async createProposal(
    workspaceId: string,
    configurationId: string,
    restartOfExecutionId?: string,
  ): Promise<RunExecution> {
    const execution = await createRunProposal({
      workspaceId,
      configurationId,
      ...(restartOfExecutionId === undefined ? {} : { restartOfExecutionId }),
      configurations: this.configurations,
      executions: this.executions,
      workspaces: this.workspaces,
    });
    this.emitStatus(undefined, execution);
    recordRunExecutionAudit(this.audit, execution, 'requested');
    return execution;
  }

  private async approveAndStart(execution: RunExecution): Promise<RunExecution> {
    const configuration = this.configurations.findStoredById(execution.configurationId);
    if (
      configuration === null ||
      configuration.workspaceId !== execution.workspaceId ||
      configuration.updatedAt !== execution.command.configurationUpdatedAt
    ) {
      return this.failApprovedExecution(
        execution,
        'RUN_CONFIGURATION_CHANGED',
        '运行配置在批准前已变化，请重新发起运行。',
        true,
      );
    }
    try {
      const workspace = await this.workspaces.getById(execution.workspaceId);
      const cwd = await resolveRunWorkingDirectory(
        workspace.rootPath,
        execution.command.workingDirectory,
      );
      const environment = await resolveRunEnvironment(
        workspace.rootPath,
        configuration,
        this.secretStore,
        execution.command.environmentFileDigest,
      );
      const starting = this.executions.update(execution.id, {
        status: 'starting',
        approvalDecision: 'approve',
        approvalDecidedAt: new Date().toISOString(),
      });
      this.emitStatus(execution, starting);
      recordRunExecutionAudit(this.audit, starting, 'allowed');
      const process = await this.supervisor.start({
        executionId: execution.id,
        executable: execution.command.executable,
        args: [...execution.command.runtimeArgs, ...execution.command.args],
        cwd,
        resolvedEnvironment: environment.values,
        sensitiveValues: environment.sensitiveValues,
      });
      const running = this.executions.update(execution.id, {
        status: 'running',
        processId: process.pid,
        startedAt: process.startedAt,
      });
      this.emitStatus(starting, running);
      recordRunExecutionAudit(this.audit, running, 'started');
      return running;
    } catch (error) {
      const current = this.requireExecution(execution.id);
      return this.failApprovedExecution(
        current,
        'RUN_START_FAILED',
        `项目启动失败：${safeErrorMessage(error)}`,
        true,
      );
    }
  }

  private failApprovedExecution(
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

  private async handleProcessEvent(
    event: Exclude<RunProcessEvent, { type: 'started' }>,
  ): Promise<void> {
    const execution = this.executions.findById(event.executionId);
    if (execution === null || terminalStatuses.has(execution.status)) {
      return;
    }
    if (event.type === 'exit') {
      this.finalizeExit(execution, event);
      return;
    }
    const process = this.supervisor.get(event.executionId);
    const updated = this.executions.update(event.executionId, {
      outputTail: process?.outputTail ?? appendOutputTail(execution.outputTail, event.chunk),
      outputBytes: process?.outputBytes ?? execution.outputBytes + Buffer.byteLength(event.chunk),
      outputTruncated: process?.outputTruncated ?? execution.outputTruncated,
    });
    const sequence = this.#sequences.get(event.executionId) ?? 0;
    this.#sequences.set(event.executionId, sequence + 1);
    this.emit({
      type: 'output',
      executionId: event.executionId,
      workspaceId: updated.workspaceId,
      stream: event.stream,
      sequence,
      data: event.chunk,
      occurredAt: event.timestamp,
    });
  }

  private finalizeExit(previous: RunExecution, result: RunProcessExitResult): RunExecution {
    const current = this.requireExecution(previous.id);
    if (terminalStatuses.has(current.status)) {
      return current;
    }
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
              message: safeErrorMessage(result.errorMessage),
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

  private finalizeMissingProcess(previous: RunExecution): RunExecution {
    const stopped = this.executions.update(previous.id, {
      status: 'stopped',
      processId: null,
      error: {
        code: 'RUN_PROCESS_MISSING',
        message: '运行进程已不存在，状态已清理。',
        retryable: true,
      },
      completedAt: new Date().toISOString(),
    });
    this.emitStatus(previous, stopped);
    recordRunExecutionAudit(this.audit, stopped, 'cancelled');
    return stopped;
  }

  private emitStatus(previous: RunExecution | undefined, execution: RunExecution): void {
    this.emit({
      type: 'status',
      execution,
      ...(previous === undefined ? {} : { previousStatus: previous.status }),
      occurredAt: new Date().toISOString(),
    });
  }

  private emit(event: RunEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Renderer listeners are isolated from the execution lifecycle.
      }
    }
  }

  private requireExecution(executionId: string): RunExecution {
    const execution = this.executions.findById(executionId);
    if (execution === null) {
      throw new RunExecutionServiceError('RUN_NOT_FOUND', '找不到运行记录。');
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
      if (this.#queues.get(executionId) === settled) {
        this.#queues.delete(executionId);
      }
    });
    return result;
  }
}

function appendOutputTail(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  return combined.length <= 65_536 ? combined : combined.slice(-65_536);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof RunExecutionServiceError) {
    return redactAuditText(error.message);
  }
  if (error instanceof Error) {
    return redactAuditText(error.message).slice(0, 2_000);
  }
  return '运行进程返回了无法识别的错误。';
}
