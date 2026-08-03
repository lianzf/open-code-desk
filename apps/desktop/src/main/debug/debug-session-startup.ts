import type { DebugSession, ProjectTaskExecution } from '@open-code-desk/domain';

import type { AuditLogService } from '../audit/audit-log.service';
import type { RunConfigurationRepository } from '../run/run-configuration.repository';
import { resolveRunEnvironment } from '../run/run-execution-policy';
import type { SecretStore } from '../security/secret-store';
import type { WorkspaceService } from '../workspace/workspace.service';
import type { DebugAdapterEvent } from './debug-adapter';
import type { DebugAdapterRegistry } from './debug-adapter.registry';
import type { ActiveDebugSession } from './debug-adapter-event-handler';
import type { DebugConfigurationCoordinator } from './debug-configuration-coordinator';
import { recordDebugSessionAudit } from './debug-session-audit';
import type { DebugSessionRepository } from './debug-session.repository';

type StoredRunConfiguration = NonNullable<ReturnType<RunConfigurationRepository['findStoredById']>>;

interface DebugSessionStartupOptions {
  readonly configurations: RunConfigurationRepository;
  readonly sessions: DebugSessionRepository;
  readonly workspaces: WorkspaceService;
  readonly secretStore: SecretStore;
  readonly adapters: DebugAdapterRegistry;
  readonly configuration: DebugConfigurationCoordinator;
  readonly active: Map<string, ActiveDebugSession>;
  readonly runners: Map<string, Promise<void>>;
  readonly audit?: AuditLogService | undefined;
  executeHook(session: DebugSession, phase: 'pre' | 'post'): Promise<ProjectTaskExecution>;
  fail(previous: DebugSession, code: string, message: string): DebugSession;
  emitStatus(previous: DebugSession | undefined, session: DebugSession): void;
  onAdapterEvent(sessionId: string, event: DebugAdapterEvent): void;
}

export class DebugSessionStartup {
  public constructor(private readonly options: DebugSessionStartupOptions) {}

  public startApproved(session: DebugSession): DebugSession {
    const configuration = this.options.configurations.findStoredById(session.configurationId);
    if (
      configuration === null ||
      configuration.workspaceId !== session.workspaceId ||
      configuration.updatedAt !== session.command.configurationUpdatedAt
    ) {
      return this.options.fail(
        session,
        'DEBUG_CONFIGURATION_CHANGED',
        '调试配置已变化，请重新发起调试。',
      );
    }
    const starting = this.options.sessions.update(session.id, {
      status: 'starting',
      approvalDecision: 'approve',
      approvalDecidedAt: new Date().toISOString(),
      adapterProcessId: null,
      pause: null,
      outputTail: '',
      outputBytes: 0,
      error: null,
      completedAt: null,
    });
    this.options.emitStatus(session, starting);
    recordDebugSessionAudit(this.options.audit, starting, 'allowed');
    const runner = this.launchApproved(starting, configuration).catch((error: unknown) => {
      const current = this.requireSession(starting.id);
      if (!['stopped', 'completed', 'failed', 'rejected'].includes(current.status)) {
        this.options.fail(
          current,
          'DEBUG_START_FAILED',
          `调试启动失败：${safeErrorMessage(error)}`,
        );
      }
    });
    this.options.runners.set(starting.id, runner);
    void runner.finally(() => this.options.runners.delete(starting.id));
    return starting;
  }

  private async launchApproved(
    session: DebugSession,
    configuration: StoredRunConfiguration,
  ): Promise<void> {
    try {
      if (session.command.preLaunchTaskPlan !== undefined) {
        const taskExecution = await this.options.executeHook(session, 'pre');
        const current = this.requireSession(session.id);
        if (current.status === 'stopping') return;
        if (taskExecution.status !== 'completed') {
          this.options.fail(
            current,
            'DEBUG_PRE_LAUNCH_TASK_FAILED',
            `调试前任务执行失败：${taskExecution.error?.message ?? taskExecution.status}`,
          );
          return;
        }
      }
      if (this.requireSession(session.id).status === 'stopping') return;
      const workspace = await this.options.workspaces.getById(session.workspaceId);
      const environment = await resolveRunEnvironment(
        workspace.rootPath,
        configuration,
        this.options.secretStore,
        session.command.environmentFileDigest,
      );
      const exceptionPolicy = this.options.configuration.settings.current(session.workspaceId);
      const adapter = await this.options.adapters.get(session.adapterType).createSession({
        sessionId: session.id,
        workspaceRoot: workspace.rootPath,
        command: session.command,
        environment: environment.values,
        sensitiveValues: environment.sensitiveValues,
        breakpoints: this.options.configuration.breakpoints.listWorkspace(session.workspaceId),
        exceptionPolicy,
      });
      if (this.requireSession(session.id).status === 'stopping') {
        await adapter.disconnect();
        return;
      }
      const active: ActiveDebugSession = {
        adapter,
        terminating: false,
        unsubscribe: () => undefined,
      };
      this.options.active.set(session.id, active);
      active.unsubscribe = adapter.subscribe((event) =>
        this.options.onAdapterEvent(session.id, event),
      );
      const running = this.options.sessions.update(session.id, {
        status: 'running',
        adapterProcessId: adapter.processId,
        capabilities: adapter.capabilities,
        startedAt: new Date().toISOString(),
      });
      this.options.emitStatus(session, running);
      recordDebugSessionAudit(this.options.audit, running, 'started');
      await this.options.configuration.breakpoints.refreshAll(session.workspaceId);
    } catch (error) {
      const current = this.requireSession(session.id);
      if (!['stopped', 'completed', 'failed', 'rejected'].includes(current.status)) {
        this.options.fail(
          current,
          'DEBUG_START_FAILED',
          `调试启动失败：${safeErrorMessage(error)}`,
        );
      }
    }
  }

  private requireSession(sessionId: string): DebugSession {
    const session = this.options.sessions.findById(sessionId);
    if (session === null) throw new Error('找不到调试会话。');
    return session;
  }
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : '调试器返回了无法识别的错误。';
}
