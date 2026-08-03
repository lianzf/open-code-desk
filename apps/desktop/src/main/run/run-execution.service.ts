import type { RunEvent, RunExecution, RunPortInspection } from '@open-code-desk/domain';
import type {
  DecideRunStartRequest,
  ListRunHistoryRequest,
  InspectRunPortRequest,
  ProposeRunStartRequest,
  RestartRunExecutionRequest,
  StopRunExecutionRequest,
  TerminateRunPortProcessRequest,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import type { ProjectTaskExecutionService } from '../project-tasks/project-task-execution.service';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { RunConfigurationRepository } from './run-configuration.repository';
import { recordRunExecutionAudit } from './run-execution-audit';
import { RunExecutionServiceError } from './run-execution-errors';
import {
  isTerminalRunStatus,
  RunExecutionLifecycle,
  safeRunErrorMessage,
} from './run-execution-lifecycle';
import { createRunProposal } from './run-execution-proposal';
import type { RunExecutionRepository } from './run-execution.repository';
import { RunPortService } from './run-port.service';
import { RunProcessSupervisor, type RunProcessEvent } from './run-process-supervisor';

type RunEventListener = (event: RunEvent) => void;

export { RunExecutionServiceError } from './run-execution-errors';

export class RunExecutionService {
  readonly #listeners = new Set<RunEventListener>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #lifecycleRunners = new Map<string, Promise<void>>();
  readonly #sequences = new Map<string, number>();
  readonly #unsubscribeSupervisor: () => void;
  readonly #ports: RunPortService;
  readonly #lifecycle: RunExecutionLifecycle;
  #closing = false;

  public constructor(
    private readonly configurations: RunConfigurationRepository,
    private readonly executions: RunExecutionRepository,
    private readonly workspaces: WorkspaceService,
    private readonly secretStore: SecretStore,
    private readonly supervisor: RunProcessSupervisor = new RunProcessSupervisor(),
    private readonly audit?: AuditLogService,
    private readonly taskExecutions?: ProjectTaskExecutionService,
  ) {
    this.#ports = new RunPortService(() => this.supervisor.list());
    this.#lifecycle = new RunExecutionLifecycle(
      this.executions,
      this.workspaces,
      this.secretStore,
      this.supervisor,
      this.#ports,
      (previous, execution) => this.emitStatus(previous, execution),
      () => this.#closing,
      this.audit,
      this.taskExecutions,
    );
    this.#unsubscribeSupervisor = this.supervisor.subscribe((event) => {
      if (event.type === 'output') this.handleProcessOutput(event);
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

  public async inspectPort(input: InspectRunPortRequest): Promise<RunPortInspection> {
    await this.workspaces.getById(input.workspaceId);
    return this.#ports.inspect(input.port);
  }

  public async terminatePortProcess(
    input: TerminateRunPortProcessRequest,
  ): Promise<RunPortInspection> {
    await this.workspaces.getById(input.workspaceId);
    const inspection = await this.#ports.inspect(input.port);
    if (inspection.available) return inspection;
    if (inspection.processId !== input.expectedProcessId) {
      throw new RunExecutionServiceError(
        'RUN_PORT_OWNER_CHANGED',
        '端口占用进程已变化，请重新检查并确认。',
        true,
      );
    }
    if (inspection.managedExecutionId !== undefined) {
      const execution = this.executions.findById(inspection.managedExecutionId);
      if (execution === null || execution.workspaceId !== input.workspaceId) {
        throw new RunExecutionServiceError(
          'RUN_PORT_OWNER_INVALID',
          '端口对应的运行记录不属于当前工作区。',
        );
      }
      await this.stop({ executionId: execution.id });
    } else {
      await this.#ports.terminateExternal(input.port, input.expectedProcessId);
    }
    this.audit?.record({
      workspaceId: input.workspaceId,
      actor: 'user',
      category: 'command',
      action: 'run.port.terminate',
      outcome: 'allowed',
      summary: `User confirmed termination of the process occupying TCP port ${input.port}.`,
      metadata: { port: input.port, processId: input.expectedProcessId },
    });
    return this.#ports.inspect(input.port);
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
      if (isTerminalRunStatus(execution.status)) {
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
      await this.#lifecycle.stopActiveHook(execution.id);
      await this.supervisor.stop(execution.id);
      await this.#lifecycleRunners.get(execution.id);
      const current = this.requireExecution(execution.id);
      return isTerminalRunStatus(current.status) ? current : this.finalizeMissingProcess(current);
    });
  }

  public async restart(input: RestartRunExecutionRequest): Promise<RunExecution> {
    const original = this.requireExecution(input.executionId);
    if (!isTerminalRunStatus(original.status)) {
      await this.stop({ executionId: original.id });
    }
    return this.createProposal(original.workspaceId, original.configurationId, original.id);
  }

  public async close(): Promise<void> {
    this.#closing = true;
    await this.supervisor.closeAll();
    await Promise.allSettled(this.#lifecycleRunners.values());
    await Promise.allSettled(this.#queues.values());
    this.#unsubscribeSupervisor();
    this.#listeners.clear();
  }

  private async createProposal(
    workspaceId: string,
    configurationId: string,
    restartOfExecutionId?: string,
  ): Promise<RunExecution> {
    const duplicate = this.executions
      .list(workspaceId, { configurationId, limit: 1_000 })
      .find((execution) => !isTerminalRunStatus(execution.status));
    if (duplicate !== undefined) {
      throw new RunExecutionServiceError(
        'RUN_ALREADY_ACTIVE',
        '该服务已有正在进行的运行，请先停止后再启动。',
      );
    }
    const execution = await createRunProposal({
      workspaceId,
      configurationId,
      ...(restartOfExecutionId === undefined ? {} : { restartOfExecutionId }),
      configurations: this.configurations,
      executions: this.executions,
      workspaces: this.workspaces,
      ...(this.taskExecutions === undefined ? {} : { taskPlans: this.taskExecutions }),
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
      return this.#lifecycle.failApprovedExecution(
        execution,
        'RUN_CONFIGURATION_CHANGED',
        '运行配置在批准前已变化，请重新发起运行。',
        true,
      );
    }
    const starting = this.executions.update(execution.id, {
      status: 'starting',
      approvalDecision: 'approve',
      approvalDecidedAt: new Date().toISOString(),
    });
    this.emitStatus(execution, starting);
    recordRunExecutionAudit(this.audit, starting, 'allowed');
    const runner = this.#lifecycle.execute(starting, configuration).catch((error: unknown) => {
      const current = this.requireExecution(starting.id);
      if (!isTerminalRunStatus(current.status)) {
        this.#lifecycle.failApprovedExecution(
          current,
          'RUN_START_FAILED',
          `项目启动失败：${safeRunErrorMessage(error)}`,
          true,
        );
      }
    });
    this.#lifecycleRunners.set(starting.id, runner);
    void runner.finally(() => this.#lifecycleRunners.delete(starting.id));
    return starting;
  }

  private handleProcessOutput(event: Extract<RunProcessEvent, { type: 'output' }>): void {
    const execution = this.executions.findById(event.executionId);
    if (execution === null || isTerminalRunStatus(execution.status)) {
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
