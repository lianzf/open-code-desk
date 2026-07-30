import type { AgentStatus } from '@open-code-desk/domain';

const allowedTransitions: Readonly<Record<AgentStatus, ReadonlySet<AgentStatus>>> = {
  idle: new Set(['analyzing', 'cancelled']),
  analyzing: new Set(['planning', 'failed', 'cancelled']),
  planning: new Set([
    'waiting_for_approval',
    'executing_tool',
    'editing_files',
    'running_tests',
    'completed',
    'failed',
    'cancelled',
  ]),
  waiting_for_approval: new Set([
    'planning',
    'executing_tool',
    'editing_files',
    'running_tests',
    'completed',
    'failed',
    'cancelled',
  ]),
  executing_tool: new Set([
    'planning',
    'waiting_for_approval',
    'executing_tool',
    'editing_files',
    'running_tests',
    'completed',
    'failed',
    'cancelled',
  ]),
  editing_files: new Set([
    'planning',
    'waiting_for_approval',
    'running_tests',
    'completed',
    'failed',
    'cancelled',
  ]),
  running_tests: new Set([
    'planning',
    'waiting_for_approval',
    'executing_tool',
    'completed',
    'failed',
    'cancelled',
  ]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export class AgentStateTransitionError extends Error {
  public constructor(
    readonly from: AgentStatus,
    readonly to: AgentStatus,
  ) {
    super(`Invalid agent state transition: ${from} -> ${to}.`);
    this.name = 'AgentStateTransitionError';
  }
}

export class AgentStateMachine {
  public constructor(private currentStatus: AgentStatus = 'idle') {}

  public get status(): AgentStatus {
    return this.currentStatus;
  }

  public transition(nextStatus: AgentStatus): AgentStatus {
    if (!allowedTransitions[this.currentStatus].has(nextStatus)) {
      throw new AgentStateTransitionError(this.currentStatus, nextStatus);
    }
    this.currentStatus = nextStatus;
    return this.currentStatus;
  }
}
