import type { AuditOutcome, DebugSession } from '@open-code-desk/domain';

import type { AuditLogService } from '../audit/audit-log.service';

export function recordDebugSessionAudit(
  audit: AuditLogService | undefined,
  session: DebugSession,
  outcome: AuditOutcome,
): void {
  audit?.record({
    workspaceId: session.workspaceId,
    actor:
      outcome === 'allowed' || outcome === 'denied' || outcome === 'cancelled' ? 'user' : 'system',
    category: 'command',
    action: 'debug.execute',
    outcome,
    summary: `Debug configuration ${session.command.configurationName} changed to ${session.status}.`,
    metadata: {
      sessionId: session.id,
      configurationId: session.configurationId,
      adapterType: session.adapterType,
      executable: session.command.executable,
      riskLevel: session.riskLevel,
      status: session.status,
    },
  });
}
