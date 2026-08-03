import type { DebugEvent, DebugSession } from '@open-code-desk/domain';
import type { ProposeDebugStartRequest } from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import type { RunConfigurationRepository } from '../run/run-configuration.repository';
import type { ProjectTaskPlanProvider } from '../run/run-execution-proposal';
import type { WorkspaceService } from '../workspace/workspace.service';
import { createDebugProposal } from './debug-proposal';
import { recordDebugSessionAudit } from './debug-session-audit';
import type { DebugSessionRepository } from './debug-session.repository';

export interface DebugProposalServiceOptions {
  readonly configurations: RunConfigurationRepository;
  readonly sessions: DebugSessionRepository;
  readonly workspaces: WorkspaceService;
  readonly audit?: AuditLogService;
  readonly taskPlans?: ProjectTaskPlanProvider;
  readonly emit: (event: DebugEvent) => void;
}

export class DebugProposalService {
  public constructor(private readonly options: DebugProposalServiceOptions) {}

  public async propose(input: ProposeDebugStartRequest): Promise<DebugSession> {
    const conflictingSession = this.options.sessions
      .list(input.workspaceId, 1_000)
      .find((session) =>
        ['pending_approval', 'starting', 'running', 'paused', 'stopping'].includes(session.status),
      );
    if (conflictingSession !== undefined) {
      throw new Error(
        `当前工作区已有调试会话“${conflictingSession.command.configurationName}”正在处理，请先停止或拒绝它。`,
      );
    }
    const configuration = this.options.configurations.findById(input.configurationId);
    if (configuration === null || configuration.workspaceId !== input.workspaceId) {
      throw new Error('找不到当前工作区的调试配置。');
    }
    const session = await createDebugProposal({
      ...input,
      adapterType:
        configuration.debugAttach?.adapter ??
        adapterTypeForProject(configuration.type, configuration.port),
      configurations: this.options.configurations,
      sessions: this.options.sessions,
      workspaces: this.options.workspaces,
      ...(this.options.taskPlans === undefined ? {} : { taskPlans: this.options.taskPlans }),
    });
    this.options.emit({
      type: 'status',
      session,
      occurredAt: new Date().toISOString(),
    });
    recordDebugSessionAudit(this.options.audit, session, 'requested');
    return session;
  }
}

export function adapterTypeForProject(projectType: string, port?: number): string {
  if (projectType === 'electron') return 'electron-js-debug';
  if (port !== undefined && ['react', 'vue', 'nextjs'].includes(projectType)) {
    return 'browser-js-debug';
  }
  if (['node', 'typescript', 'react', 'vue', 'nextjs'].includes(projectType)) return 'pwa-node';
  if (projectType === 'python') return 'debugpy';
  if (['c', 'cpp', 'rust'].includes(projectType)) return 'lldb-dap';
  if (projectType === 'go') return 'go-delve';
  if (projectType === 'dotnet') return 'coreclr';
  if (['java-maven', 'java-gradle', 'spring-boot'].includes(projectType)) return 'java';
  throw new Error(`当前阶段尚未提供 ${projectType} 项目的调试适配器。`);
}
