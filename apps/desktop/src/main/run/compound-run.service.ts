import { randomUUID } from 'node:crypto';

import type {
  CompoundRunConfiguration,
  CompoundRunProposal,
  CompoundRunSession,
  RunEvent,
} from '@open-code-desk/domain';
import type {
  DeleteCompoundRunConfigurationRequest,
  ProposeCompoundRunRequest,
  SaveCompoundRunConfigurationRequest,
  StopCompoundRunRequest,
} from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import type { CompoundRunRepository } from './compound-run.repository';
import type { RunConfigurationRepository } from './run-configuration.repository';
import type { RunExecutionService } from './run-execution.service';

export class CompoundRunServiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CompoundRunServiceError';
  }
}

export class CompoundRunService {
  readonly #sessions = new Map<string, CompoundRunSession>();
  readonly #stoppingSessions = new Set<string>();
  readonly #unsubscribe: () => void;

  public constructor(
    private readonly repository: CompoundRunRepository,
    private readonly configurations: RunConfigurationRepository,
    private readonly executions: RunExecutionService,
    private readonly audit?: AuditLogService,
  ) {
    this.#unsubscribe = executions.subscribe((event) => this.handleRunEvent(event));
  }

  public list(workspaceId: string): ReadonlyArray<CompoundRunConfiguration> {
    return this.repository.list(workspaceId);
  }

  public listSessions(workspaceId: string): ReadonlyArray<CompoundRunSession> {
    return [...this.#sessions.values()].filter((session) => session.workspaceId === workspaceId);
  }

  public save(input: SaveCompoundRunConfigurationRequest): CompoundRunConfiguration {
    const configurationIds = [...new Set(input.configurationIds)];
    if (configurationIds.length < 2) {
      throw new CompoundRunServiceError('组合运行至少需要两个不同的运行配置。');
    }
    for (const configurationId of configurationIds) {
      const configuration = this.configurations.findById(configurationId);
      if (configuration === null || configuration.workspaceId !== input.workspaceId) {
        throw new CompoundRunServiceError('组合中的运行配置不属于当前工作区或已被删除。');
      }
    }
    return this.repository.save({
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      configurationIds,
      stopAllOnSingleFailure: input.stopAllOnSingleFailure,
    });
  }

  public delete(input: DeleteCompoundRunConfigurationRequest): boolean {
    return this.repository.delete(input.workspaceId, input.compoundConfigurationId);
  }

  public async proposeStart(input: ProposeCompoundRunRequest): Promise<CompoundRunProposal> {
    const compound = this.repository.findById(input.compoundConfigurationId);
    if (compound === null || compound.workspaceId !== input.workspaceId) {
      throw new CompoundRunServiceError('找不到当前工作区的组合运行配置。');
    }
    const proposed = [];
    try {
      for (const configurationId of compound.configurationIds) {
        proposed.push(
          await this.executions.proposeStart({ workspaceId: input.workspaceId, configurationId }),
        );
      }
    } catch (error) {
      await Promise.allSettled(
        proposed.map((execution) => this.executions.stop({ executionId: execution.id })),
      );
      throw error;
    }
    const session: CompoundRunSession = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      compoundConfigurationId: compound.id,
      compoundConfigurationName: compound.name,
      executionIds: proposed.map((execution) => execution.id),
      stopAllOnSingleFailure: compound.stopAllOnSingleFailure,
      createdAt: new Date().toISOString(),
    };
    this.#sessions.set(session.id, session);
    this.audit?.record({
      workspaceId: input.workspaceId,
      actor: 'system',
      category: 'command',
      action: 'run.compound.execute',
      outcome: 'requested',
      summary: `Compound run ${compound.name} requested ${proposed.length} services.`,
      metadata: { compoundConfigurationId: compound.id, sessionId: session.id },
    });
    return { session, executions: proposed };
  }

  public async stopAll(input: StopCompoundRunRequest): Promise<CompoundRunSession> {
    const session = this.#sessions.get(input.sessionId);
    if (session === undefined || session.workspaceId !== input.workspaceId) {
      throw new CompoundRunServiceError('找不到当前工作区的组合运行会话。');
    }
    await this.stopSession(session);
    return session;
  }

  public close(): void {
    this.#unsubscribe();
    this.#sessions.clear();
  }

  private handleRunEvent(event: RunEvent): void {
    if (event.type !== 'status' || event.execution.status !== 'failed') return;
    const session = [...this.#sessions.values()].find(
      (candidate) =>
        candidate.stopAllOnSingleFailure && candidate.executionIds.includes(event.execution.id),
    );
    if (session !== undefined) void this.stopSession(session);
  }

  private async stopSession(session: CompoundRunSession): Promise<void> {
    if (this.#stoppingSessions.has(session.id)) return;
    this.#stoppingSessions.add(session.id);
    try {
      await Promise.allSettled(
        session.executionIds.map((executionId) => this.executions.stop({ executionId })),
      );
      this.audit?.record({
        workspaceId: session.workspaceId,
        actor: 'user',
        category: 'command',
        action: 'run.compound.stop',
        outcome: 'cancelled',
        summary: `Compound run ${session.compoundConfigurationName} stopped all services.`,
        metadata: { sessionId: session.id },
      });
    } finally {
      this.#stoppingSessions.delete(session.id);
    }
  }
}
