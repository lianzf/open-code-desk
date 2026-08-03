import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppDatabase, type AppDatabase } from '../database/database';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService active workspace authorization', () => {
  const directories: string[] = [];
  const databases: AppDatabase[] = [];

  afterEach(async () => {
    for (const database of databases.splice(0)) {
      database.close();
    }
    for (const directory of directories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not authorize a persisted recent workspace until it is explicitly opened', async () => {
    const firstPath = await realpath(await mkdtemp(join(tmpdir(), 'open-code-desk-active-')));
    const secondPath = await realpath(await mkdtemp(join(tmpdir(), 'open-code-desk-recent-')));
    directories.push(firstPath, secondPath);
    const database = createAppDatabase(':memory:');
    databases.push(database);
    const repository = new WorkspaceRepository(database);
    const first = repository.upsert(firstPath);
    const second = repository.upsert(secondPath);
    const service = new WorkspaceService(repository, {
      async pickDirectory() {
        return firstPath;
      },
    });

    await expect(service.getById(first.id)).rejects.toThrow('not the active workspace');
    await service.openRecent(first.id);
    await expect(service.getById(first.id)).resolves.toMatchObject({ rootPath: firstPath });
    await expect(service.getById(second.id)).rejects.toThrow('not the active workspace');
  });
});
