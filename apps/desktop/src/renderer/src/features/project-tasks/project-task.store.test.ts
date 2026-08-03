import type { ProjectTaskExecution } from '@open-code-desk/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { appendProjectTaskOutput, mergeProjectTaskExecution } from './project-task.store';

function execution(
  status: ProjectTaskExecution['status'],
  updatedAt: string,
  outputBytes = 0,
): ProjectTaskExecution {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    rootTaskId: '00000000-0000-4000-8000-000000000003',
    plan: [
      {
        taskId: '00000000-0000-4000-8000-000000000003',
        taskUpdatedAt: '2026-01-01T00:00:00.000Z',
        taskName: 'test',
        taskType: 'test',
        executable: 'node',
        args: ['test.js'],
        workingDirectory: '',
        environmentVariables: [],
        timeoutMs: 5_000,
        riskLevel: 'low',
        riskReasons: [],
      },
    ],
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

describe('mergeProjectTaskExecution', () => {
  it('does not let an older approval response replace a newer running event', () => {
    const running = execution('running', '2026-01-01T00:00:00.002Z');
    const delayedPending = execution('pending_approval', '2026-01-01T00:00:00.001Z');

    expect(mergeProjectTaskExecution([running], delayedPending)[0]?.status).toBe('running');
  });

  it('accepts forward progress at the same update timestamp', () => {
    const starting = execution('starting', '2026-01-01T00:00:00.001Z');
    const running = execution('running', '2026-01-01T00:00:00.001Z');

    expect(mergeProjectTaskExecution([starting], running)[0]?.status).toBe('running');
  });
});

describe('appendProjectTaskOutput', () => {
  it('keeps a bounded output tail while counting UTF-8 bytes', () => {
    const current = execution('running', '2026-01-01T00:00:00.001Z');
    const updated = appendProjectTaskOutput(current, `${'x'.repeat(70_000)}中`);

    expect(updated.outputTail).toHaveLength(65_536);
    expect(updated.outputBytes).toBe(70_003);
  });
});
