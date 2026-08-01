import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { DebugBreakpointRepository } from './debug-breakpoint.repository';
import { DebugSessionRepository } from './debug-session.repository';
import { DebugWatchRepository } from './debug-watch.repository';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('debug persistence', () => {
  it('migrates, restores breakpoints and watches, and recovers an interrupted session', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-database-'));
    temporaryPaths.push(rootPath);
    const databasePath = join(rootPath, 'application.sqlite');
    const first = createAppDatabase(databasePath);
    const workspace = new WorkspaceRepository(first).upsert(rootPath);
    const breakpoints = new DebugBreakpointRepository(first);
    const watches = new DebugWatchRepository(first);
    const sessions = new DebugSessionRepository(first);
    const configurationId = '00000000-0000-4000-8000-000000000101';
    const breakpoint = breakpoints.save({
      workspaceId: workspace.id,
      relativePath: 'src/index.ts',
      line: 12,
      enabled: true,
    });
    breakpoints.updateVerification(breakpoint.id, 'verified', 42, undefined);
    const watch = watches.save({ workspaceId: workspace.id, expression: 'request.user.id' });
    const session = sessions.create({
      workspaceId: workspace.id,
      configurationId,
      adapterType: 'pwa-node',
      command: {
        configurationId,
        configurationUpdatedAt: new Date().toISOString(),
        configurationName: '持久化调试',
        projectType: 'typescript',
        executable: process.execPath,
        runtimeArgs: [],
        args: ['src/index.ts'],
        workingDirectory: '',
        environmentVariables: [],
        console: 'runOutput',
      },
      riskLevel: 'low',
      riskReasons: [],
      approvalDigest: 'a'.repeat(64),
    });
    sessions.update(session.id, {
      status: 'running',
      approvalDecision: 'approve',
      adapterProcessId: 12345,
      startedAt: new Date().toISOString(),
    });
    first.close();

    const reopened = createAppDatabase(databasePath);
    const version = reopened.client.prepare('PRAGMA user_version').get() as {
      readonly user_version: number;
    };
    expect(version.user_version).toBeGreaterThanOrEqual(10);
    const restoredBreakpoints = new DebugBreakpointRepository(reopened).list(workspace.id);
    const restoredWatches = new DebugWatchRepository(reopened).list(workspace.id);
    const restoredSessions = new DebugSessionRepository(reopened);

    expect(restoredBreakpoints).toContainEqual(
      expect.objectContaining({
        id: breakpoint.id,
        relativePath: 'src/index.ts',
        line: 12,
        status: 'verified',
        adapterBreakpointId: 42,
      }),
    );
    expect(restoredWatches).toContainEqual(watch);
    expect(restoredSessions.recoverInterrupted()).toBe(1);
    expect(restoredSessions.findById(session.id)).toMatchObject({
      status: 'failed',
      error: { code: 'DEBUG_INTERRUPTED', retryable: true },
    });
    reopened.close();
  });
});
