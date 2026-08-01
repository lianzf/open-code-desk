import type { DebugEvent, DebugSession } from '@open-code-desk/domain';
import type { ProposeDebugStartRequest } from '@open-code-desk/ipc-contracts';

import type { AuditLogService } from '../audit/audit-log.service';
import type { RunConfigurationRepository } from '../run/run-configuration.repository';
import type { WorkspaceService } from '../workspace/workspace.service';
import { createDebugProposal } from './debug-proposal';
import { recordDebugSessionAudit } from './debug-session-audit';
import type { DebugSessionRepository } from './debug-session.repository';

export interface DebugProposalServiceOptions {
  readonly configurations: RunConfigurationRepository;
  readonly sessions: DebugSessionRepository;
  readonly workspaces: WorkspaceService;
  readonly audit?: AuditLogService;
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
      adapterType: adapterTypeForProject(configuration.type),
      configurations: this.options.configurations,
      sessions: this.options.sessions,
      workspaces: this.options.workspaces,
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

function adapterTypeForProject(projectType: string): string {
  if (['node', 'typescript', 'react', 'vue', 'nextjs'].includes(projectType)) return 'pwa-node';
  throw new Error(`当前阶段尚未提供 ${projectType} 项目的调试适配器。`);
}
