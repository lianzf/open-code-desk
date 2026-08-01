import type { RunExecution } from '@open-code-desk/domain';

import type { AuditLogService } from '../audit/audit-log.service';

export type RunAuditOutcome =
  'requested' | 'allowed' | 'denied' | 'started' | 'succeeded' | 'failed' | 'cancelled';

export function recordRunExecutionAudit(
  audit: AuditLogService | undefined,
  execution: RunExecution,
  outcome: RunAuditOutcome,
): void {
  audit?.record({
    workspaceId: execution.workspaceId,
    actor:
      outcome === 'requested'
        ? 'system'
        : outcome === 'allowed' || outcome === 'denied'
          ? 'user'
          : 'system',
    category: 'command',
    action: 'run.execute',
    outcome,
    summary: `Run configuration ${execution.command.configurationName} changed to ${execution.status}.`,
    metadata: {
      executionId: execution.id,
      configurationId: execution.configurationId,
      executable: execution.command.executable,
      riskLevel: execution.riskLevel,
      status: execution.status,
    },
  });
}
