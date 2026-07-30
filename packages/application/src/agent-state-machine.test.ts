import { describe, expect, it } from 'vitest';

import { AgentStateMachine, AgentStateTransitionError } from './agent-state-machine';

describe('AgentStateMachine', () => {
  it('supports a read-tool agent loop', () => {
    const machine = new AgentStateMachine();
    expect(machine.transition('analyzing')).toBe('analyzing');
    expect(machine.transition('planning')).toBe('planning');
    expect(machine.transition('executing_tool')).toBe('executing_tool');
    expect(machine.transition('planning')).toBe('planning');
    expect(machine.transition('completed')).toBe('completed');
  });

  it('rejects transitions out of a terminal state', () => {
    const machine = new AgentStateMachine('completed');
    expect(() => machine.transition('planning')).toThrow(AgentStateTransitionError);
  });
});
