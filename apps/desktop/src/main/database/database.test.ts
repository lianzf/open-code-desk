import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase } from './database';
import { WorkspaceRepository } from '../workspace/workspace.repository';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

describe('workspace database', () => {
  it('persists a recent workspace across database restarts', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-db-'));
    temporaryPaths.push(temporaryDirectory);
    const canonicalDirectory = await realpath(temporaryDirectory);
    const databasePath = join(temporaryDirectory, 'application.sqlite');

    const firstDatabase = createAppDatabase(databasePath);
    const inserted = new WorkspaceRepository(firstDatabase).upsert(canonicalDirectory);
    firstDatabase.close();

    const reopenedDatabase = createAppDatabase(databasePath);
    const recent = new WorkspaceRepository(reopenedDatabase).listRecent();
    reopenedDatabase.close();

    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      id: inserted.id,
      rootPath: canonicalDirectory,
    });
  });
});
