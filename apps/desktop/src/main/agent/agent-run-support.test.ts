import { describe, expect, it } from 'vitest';

import { AgentRunLimitError, defaultAgentRunLimits, unexpectedError } from './agent-run-support';

describe('Agent run limits', () => {
  it('uses a practical bounded default for long coding tasks', () => {
    expect(defaultAgentRunLimits).toEqual({
      maximumAgentRounds: 24,
      maximumToolCalls: 64,
    });
  });

  it.each([
    ['tool_calls', 64, '64-tool-call'],
    ['model_rounds', 24, '24-model-round'],
  ] as const)('maps a %s limit to a retryable application error', (kind, limit, marker) => {
    expect(unexpectedError(new AgentRunLimitError(kind, limit))).toEqual({
      code: 'AGENT_BUDGET_EXCEEDED',
      message: expect.stringContaining(marker),
      retryable: true,
    });
  });
});
