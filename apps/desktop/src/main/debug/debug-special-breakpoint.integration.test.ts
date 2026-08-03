import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase } from '../database/database';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { DebugBreakpointRepository } from './debug-breakpoint.repository';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('special debug breakpoint persistence', () => {
  it('persists function and data breakpoint identities without treating them as source lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-special-breakpoints-'));
    temporaryPaths.push(root);
    const databasePath = join(root, 'application.sqlite');
    const database = createAppDatabase(databasePath);
    const workspace = new WorkspaceRepository(database).upsert(root);
    const repository = new DebugBreakpointRepository(database);
    const functionBreakpoint = repository.save({
      workspaceId: workspace.id,
      relativePath: '@function/target',
      line: 1,
      kind: 'function',
      functionName: 'targetFunction',
      enabled: true,
    });
    const dataBreakpoint = repository.save({
      workspaceId: workspace.id,
      relativePath: '@data/counter',
      line: 1,
      kind: 'data',
      dataId: 'adapter-owned-counter-id',
      dataAccessType: 'readWrite',
      enabled: true,
    });
    database.close();

    const reopened = createAppDatabase(databasePath);
    expect(new DebugBreakpointRepository(reopened).list(workspace.id)).toEqual([
      expect.objectContaining({
        id: dataBreakpoint.id,
        kind: 'data',
        dataId: 'adapter-owned-counter-id',
        dataAccessType: 'readWrite',
      }),
      expect.objectContaining({
        id: functionBreakpoint.id,
        kind: 'function',
        functionName: 'targetFunction',
      }),
    ]);
    reopened.close();
  });
});
