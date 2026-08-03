import type { ProjectTaskExecution } from '@open-code-desk/domain';

import type { AuditLogService } from '../audit/audit-log.service';

export type ProjectTaskAuditOutcome =
  'requested' | 'allowed' | 'denied' | 'started' | 'succeeded' | 'failed' | 'cancelled';

export function recordProjectTaskExecutionAudit(
  audit: AuditLogService | undefined,
  execution: ProjectTaskExecution,
  outcome: ProjectTaskAuditOutcome,
): void {
  const rootTask = execution.plan.find((step) => step.taskId === execution.rootTaskId);
  audit?.record({
    workspaceId: execution.workspaceId,
    actor:
      outcome === 'requested'
        ? 'system'
        : outcome === 'allowed' || outcome === 'denied'
          ? 'user'
          : 'system',
    category: 'command',
    action: 'project-task.execute',
    outcome,
    summary: `Project task ${rootTask?.taskName ?? execution.rootTaskId} changed to ${execution.status}.`,
    metadata: {
      executionId: execution.id,
      rootTaskId: execution.rootTaskId,
      currentTaskId: execution.currentTaskId ?? null,
      riskLevel: execution.riskLevel,
      status: execution.status,
      stepCount: execution.plan.length,
    },
  });
}
