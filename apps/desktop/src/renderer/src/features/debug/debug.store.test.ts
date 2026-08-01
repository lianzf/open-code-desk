import type { DebugBreakpoint, DebugSession } from '@open-code-desk/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { mergeDebugBreakpoint, mergeDebugSession } from './debug.store';

describe('mergeDebugSession', () => {
  it('does not replace a newer paused event with an older running response', () => {
    const paused = session('paused', '2026-08-02T00:00:00.003Z');
    const delayedRunning = session('running', '2026-08-02T00:00:00.002Z');

    expect(mergeDebugSession([paused], delayedRunning)[0]?.status).toBe('paused');
  });

  it('accepts the later resume snapshot after a pause', () => {
    const paused = session('paused', '2026-08-02T00:00:00.003Z');
    const resumed = session('running', '2026-08-02T00:00:00.004Z');

    expect(mergeDebugSession([paused], resumed)[0]?.status).toBe('running');
  });
});

describe('mergeDebugBreakpoint', () => {
  it('keeps a save response idempotent after the full-list event arrived first', () => {
    const saved = breakpoint('00000000-0000-4000-8000-000000000301');

    expect(mergeDebugBreakpoint([saved], saved)).toEqual([saved]);
  });

  it('deduplicates a logical location even when a stale client id differs', () => {
    const stale = breakpoint('00000000-0000-4000-8000-000000000301');
    const saved = breakpoint('00000000-0000-4000-8000-000000000302');

    expect(mergeDebugBreakpoint([stale], saved)).toEqual([saved]);
  });
});

function session(status: DebugSession['status'], updatedAt: string): DebugSession {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    workspaceId: '00000000-0000-4000-8000-000000000202',
    configurationId: '00000000-0000-4000-8000-000000000203',
    adapterType: 'pwa-node',
    command: {
      configurationId: '00000000-0000-4000-8000-000000000203',
      configurationUpdatedAt: '2026-08-02T00:00:00.000Z',
      configurationName: '调试竞态测试',
      projectType: 'node',
      executable: 'node',
      runtimeArgs: [],
      args: ['index.js'],
      workingDirectory: '',
      environmentVariables: [],
      console: 'runOutput',
    },
    status,
    riskLevel: 'low',
    riskReasons: [],
    approvalDigest: 'a'.repeat(64),
    outputTail: '',
    outputBytes: 0,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt,
  };
}

function breakpoint(id: string): DebugBreakpoint {
  return {
    id,
    workspaceId: '00000000-0000-4000-8000-000000000202',
    relativePath: 'program.js',
    line: 3,
    enabled: true,
    status: 'pending',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.001Z',
  };
}
