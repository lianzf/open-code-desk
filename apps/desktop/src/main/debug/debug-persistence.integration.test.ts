import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { DebugBreakpointRepository } from './debug-breakpoint.repository';
import { DebugSessionRepository } from './debug-session.repository';
import { DebugSettingsRepository } from './debug-settings.repository';
import { DebugWatchRepository } from './debug-watch.repository';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('debug persistence', () => {
  it('upgrades version 10 breakpoint rows without losing their locations', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-migration-'));
    temporaryPaths.push(rootPath);
    const databasePath = join(rootPath, 'legacy.sqlite');
    const workspaceId = '00000000-0000-4000-8000-000000000201';
    const breakpointId = '00000000-0000-4000-8000-000000000202';
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE debug_breakpoints (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        status TEXT NOT NULL,
        adapter_breakpoint_id INTEGER,
        message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, relative_path, line, column)
      );
    `);
    const now = new Date().toISOString();
    legacy
      .prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?, ?)')
      .run(workspaceId, rootPath, 'legacy', now, now, now);
    legacy
      .prepare('INSERT INTO debug_breakpoints VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(breakpointId, workspaceId, 'src/index.ts', 7, 1, 1, 'pending', null, null, now, now);
    legacy.exec('PRAGMA user_version = 10;');
    legacy.close();

    const migrated = createAppDatabase(databasePath);
    expect(migrated.client.prepare('PRAGMA user_version').get()).toEqual({ user_version: 11 });
    expect(new DebugBreakpointRepository(migrated).list(workspaceId)).toContainEqual(
      expect.objectContaining({ id: breakpointId, relativePath: 'src/index.ts', line: 7 }),
    );
    expect(new DebugSettingsRepository(migrated).get(workspaceId)).toMatchObject({
      workspaceId,
      exceptionPauseMode: 'uncaught',
    });
    migrated.close();
  });

  it('migrates, restores breakpoints and watches, and recovers an interrupted session', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-debug-database-'));
    temporaryPaths.push(rootPath);
    const databasePath = join(rootPath, 'application.sqlite');
    const first = createAppDatabase(databasePath);
    const workspace = new WorkspaceRepository(first).upsert(rootPath);
    const breakpoints = new DebugBreakpointRepository(first);
    const watches = new DebugWatchRepository(first);
    const sessions = new DebugSessionRepository(first);
    const settings = new DebugSettingsRepository(first);
    const configurationId = '00000000-0000-4000-8000-000000000101';
    const breakpoint = breakpoints.save({
      workspaceId: workspace.id,
      relativePath: 'src/index.ts',
      line: 12,
      enabled: true,
      condition: 'request.user.id === 42',
      hitCondition: '>= 3',
      logMessage: 'request={request.user.id}',
    });
    breakpoints.updateVerification(breakpoint.id, 'verified', 42, undefined);
    const watch = watches.save({ workspaceId: workspace.id, expression: 'request.user.id' });
    const savedSettings = settings.save(workspace.id, 'all');
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
    expect(version.user_version).toBeGreaterThanOrEqual(11);
    const restoredBreakpoints = new DebugBreakpointRepository(reopened).list(workspace.id);
    const restoredWatches = new DebugWatchRepository(reopened).list(workspace.id);
    const restoredSessions = new DebugSessionRepository(reopened);
    const restoredSettings = new DebugSettingsRepository(reopened).get(workspace.id);

    expect(restoredBreakpoints).toContainEqual(
      expect.objectContaining({
        id: breakpoint.id,
        relativePath: 'src/index.ts',
        line: 12,
        status: 'verified',
        adapterBreakpointId: 42,
        condition: 'request.user.id === 42',
        hitCondition: '>= 3',
        logMessage: 'request={request.user.id}',
      }),
    );
    expect(restoredSettings).toEqual(savedSettings);
    expect(restoredWatches).toContainEqual(watch);
    expect(restoredSessions.recoverInterrupted()).toBe(1);
    expect(restoredSessions.findById(session.id)).toMatchObject({
      status: 'failed',
      error: { code: 'DEBUG_INTERRUPTED', retryable: true },
    });
    reopened.close();
  });
});
