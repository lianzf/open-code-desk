import type { RunExecution } from '@open-code-desk/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { appendRunOutput, mergeRunExecution } from './run.store';

function execution(
  status: RunExecution['status'],
  updatedAt: string,
  outputBytes = 0,
): RunExecution {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    configurationId: '00000000-0000-4000-8000-000000000003',
    command: {
      configurationId: '00000000-0000-4000-8000-000000000003',
      configurationUpdatedAt: '2026-01-01T00:00:00.000Z',
      configurationName: 'test',
      projectType: 'node',
      executable: 'node',
      runtimeArgs: [],
      args: ['server.js'],
      workingDirectory: '',
      environmentVariables: [],
      console: 'runOutput',
    },
    status,
    riskLevel: 'low',
    riskReasons: [],
    approvalDigest: 'a'.repeat(64),
    ...(status === 'pending_approval' ? {} : { approvalDecision: 'approve' as const }),
    outputTail: '',
    outputBytes,
    outputTruncated: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('mergeRunExecution', () => {
  it('does not let an older approval response replace a newer running event', () => {
    const running = execution('running', '2026-01-01T00:00:00.002Z');
    const delayedPending = execution('pending_approval', '2026-01-01T00:00:00.001Z');

    expect(mergeRunExecution([running], delayedPending)[0]?.status).toBe('running');
  });

  it('accepts forward progress at the same update timestamp', () => {
    const starting = execution('starting', '2026-01-01T00:00:00.001Z');
    const running = execution('running', '2026-01-01T00:00:00.001Z');

    expect(mergeRunExecution([starting], running)[0]?.status).toBe('running');
  });
});

describe('appendRunOutput', () => {
  it('keeps a bounded output tail while counting UTF-8 bytes', () => {
    const current = execution('running', '2026-01-01T00:00:00.001Z');
    const updated = appendRunOutput(current, `${'x'.repeat(70_000)}中`);

    expect(updated.outputTail).toHaveLength(65_536);
    expect(updated.outputBytes).toBe(70_003);
  });
});
