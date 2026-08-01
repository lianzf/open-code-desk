import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunCommandSnapshot, RunStatus } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { RunExecutionRepository } from './run-execution.repository';

const temporaryPaths: string[] = [];
const approvalDigest = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

function command(configurationId: string): RunCommandSnapshot {
  return {
    configurationId,
    configurationUpdatedAt: '2026-08-01T12:00:00.000Z',
    configurationName: 'Development server',
    projectType: 'typescript',
    executable: 'pnpm',
    runtimeArgs: [],
    args: ['dev'],
    workingDirectory: '',
    environmentVariables: [
      { name: 'PUBLIC_FLAG', value: 'visible', sensitive: false, configured: true },
      { name: 'API_TOKEN', sensitive: true, configured: true },
    ],
    console: 'runOutput',
  };
}

describe('run execution persistence', () => {
  it('persists immutable command snapshots, output accounting, and history filters', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-run-execution-'));
    temporaryPaths.push(temporaryDirectory);
    const databasePath = join(temporaryDirectory, 'application.sqlite');
    const firstDatabase = createAppDatabase(databasePath);
    const workspace = new WorkspaceRepository(firstDatabase).upsert(temporaryDirectory);
    const repository = new RunExecutionRepository(firstDatabase);
    const configurationId = randomUUID();
    const otherConfigurationId = randomUUID();

    const created = repository.create({
      workspaceId: workspace.id,
      configurationId,
      command: command(configurationId),
      riskLevel: 'medium',
      riskReasons: ['Runs a project-defined script.'],
      approvalDigest,
    });
    repository.create({
      workspaceId: workspace.id,
      configurationId: otherConfigurationId,
      command: command(otherConfigurationId),
      riskLevel: 'low',
      riskReasons: [],
      approvalDigest: 'b'.repeat(64),
    });

    const startedAt = new Date().toISOString();
    const running = repository.update(created.id, {
      status: 'running',
      approvalDecision: 'approve',
      processId: 42,
      outputTail: 'server ready\n',
      outputBytes: 13,
      outputTruncated: false,
      approvalDecidedAt: startedAt,
      startedAt,
    });
    expect(running).toMatchObject({
      id: created.id,
      configurationId,
      status: 'running',
      processId: 42,
      outputBytes: 13,
      command: command(configurationId),
    });
    expect(repository.list(workspace.id, { configurationId })).toEqual([running]);

    const raw = firstDatabase.client
      .prepare(
        `SELECT command_snapshot, output_tail, output_bytes
         FROM run_executions WHERE id = ?`,
      )
      .get(created.id) as {
      readonly command_snapshot: string;
      readonly output_tail: string;
      readonly output_bytes: number;
    };
    expect(raw.command_snapshot).not.toContain('top-secret-value');
    expect(raw.output_tail).toBe('server ready\n');
    expect(raw.output_bytes).toBe(13);
    firstDatabase.close();

    const reopenedDatabase = createAppDatabase(databasePath);
    const reopened = new RunExecutionRepository(reopenedDatabase).findById(created.id);
    reopenedDatabase.close();
    expect(reopened).toEqual(running);
  });

  it('rejects a command snapshot that would persist a sensitive environment value', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-run-secret-'));
    temporaryPaths.push(temporaryDirectory);
    const database = createAppDatabase(join(temporaryDirectory, 'application.sqlite'));
    const workspace = new WorkspaceRepository(database).upsert(temporaryDirectory);
    const repository = new RunExecutionRepository(database);
    const configurationId = randomUUID();

    expect(() =>
      repository.create({
        workspaceId: workspace.id,
        configurationId,
        command: {
          ...command(configurationId),
          environmentVariables: [
            {
              name: 'API_TOKEN',
              value: 'top-secret-value',
              sensitive: true,
              configured: true,
            },
          ],
        },
        riskLevel: 'high',
        riskReasons: ['Sensitive test fixture.'],
        approvalDigest,
      }),
    ).toThrow('cannot be persisted');
    database.close();
  });

  it('recovers interrupted runs without changing pending approvals or terminal records', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-run-recovery-'));
    temporaryPaths.push(temporaryDirectory);
    const database = createAppDatabase(join(temporaryDirectory, 'application.sqlite'));
    const workspace = new WorkspaceRepository(database).upsert(temporaryDirectory);
    const repository = new RunExecutionRepository(database);
    const records = new Map<RunStatus, string>();

    for (const status of [
      'pending_approval',
      'starting',
      'running',
      'stopping',
      'completed',
    ] satisfies ReadonlyArray<RunStatus>) {
      const configurationId = randomUUID();
      const execution = repository.create({
        workspaceId: workspace.id,
        configurationId,
        command: command(configurationId),
        status,
        riskLevel: 'low',
        riskReasons: [],
        approvalDigest,
        ...(status === 'pending_approval' ? {} : { approvalDecision: 'approve' as const }),
        processId: 100 + records.size,
      });
      records.set(status, execution.id);
    }

    expect(repository.recoverInterrupted()).toBe(4);
    const pending = repository.findById(records.get('pending_approval') ?? '');
    const starting = repository.findById(records.get('starting') ?? '');
    const running = repository.findById(records.get('running') ?? '');
    const stopping = repository.findById(records.get('stopping') ?? '');
    const completed = repository.findById(records.get('completed') ?? '');

    expect(pending).toMatchObject({ status: 'pending_approval' });
    expect(pending).not.toHaveProperty('processId');
    for (const interrupted of [starting, running]) {
      expect(interrupted).toMatchObject({
        status: 'failed',
        error: { code: 'RUN_INTERRUPTED', retryable: true },
      });
      expect(interrupted).not.toHaveProperty('processId');
      expect(interrupted).toHaveProperty('completedAt');
    }
    expect(stopping).toMatchObject({ status: 'stopped' });
    expect(stopping).not.toHaveProperty('processId');
    expect(stopping).toHaveProperty('completedAt');
    expect(completed).toMatchObject({ status: 'completed', processId: 104 });
    database.close();
  });

  it('upgrades a version 8 database through the current migrations', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-run-migration-'));
    temporaryPaths.push(temporaryDirectory);
    const databasePath = join(temporaryDirectory, 'application.sqlite');
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
      PRAGMA user_version = 8;
    `);
    legacy.close();

    const migrated = createAppDatabase(databasePath);
    const version = migrated.client.prepare('PRAGMA user_version').get() as {
      readonly user_version: number;
    };
    const indexes = migrated.client
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND tbl_name = 'run_executions'
         AND name NOT LIKE 'sqlite_autoindex%'
         ORDER BY name`,
      )
      .all() as unknown as ReadonlyArray<{ readonly name: string }>;
    migrated.close();

    expect(version.user_version).toBe(10);
    expect(indexes.map((index) => index.name)).toEqual([
      'run_executions_configuration_created_idx',
      'run_executions_workspace_created_idx',
    ]);
  });
});
