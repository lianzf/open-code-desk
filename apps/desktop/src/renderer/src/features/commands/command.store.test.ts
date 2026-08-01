import type { CommandExecution } from '@open-code-desk/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { mergeCommandExecution } from './command.store';

function command(status: CommandExecution['status'], updatedAt: string): CommandExecution {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    conversationId: '00000000-0000-4000-8000-000000000003',
    taskId: '00000000-0000-4000-8000-000000000004',
    modelToolCallId: 'model-call',
    toolName: 'run_tests',
    executable: 'node',
    args: [],
    cwd: '/workspace',
    timeoutMs: 10_000,
    riskLevel: 'low',
    riskReasons: [],
    approvalDigest: 'digest',
    status,
    autoApproved: false,
    outputTail: '',
    outputBytes: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('mergeCommandExecution', () => {
  it('does not let a delayed approval response overwrite a streamed running state', () => {
    const running = command('running', '2026-01-01T00:00:00.002Z');
    const delayedApproved = command('approved', '2026-01-01T00:00:00.001Z');

    expect(mergeCommandExecution([running], delayedApproved)[0]?.status).toBe('running');
  });

  it('accepts forward progress and newer updates at the same state rank', () => {
    const pending = command('pending_approval', '2026-01-01T00:00:00.000Z');
    const running = command('running', '2026-01-01T00:00:00.001Z');
    const completed = command('completed', '2026-01-01T00:00:00.002Z');

    expect(mergeCommandExecution([pending], running)[0]?.status).toBe('running');
    expect(mergeCommandExecution([running], completed)[0]?.status).toBe('completed');
  });
});
