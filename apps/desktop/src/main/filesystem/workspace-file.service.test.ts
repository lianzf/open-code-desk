import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppDatabase, type AppDatabase } from '../database/database';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceFileService } from './workspace-file.service';

class FixedDirectoryPicker implements DirectoryPicker {
  public constructor(private readonly directory: string) {}

  public async pickDirectory(): Promise<string> {
    return this.directory;
  }
}

describe('WorkspaceFileService', () => {
  let temporaryDirectory: string;
  let database: AppDatabase;
  let workspaceId: string;
  let service: WorkspaceFileService;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'open-code-desk-files-'));
    await mkdir(join(temporaryDirectory, 'src'));
    await mkdir(join(temporaryDirectory, 'node_modules'));
    await writeFile(join(temporaryDirectory, 'src', 'index.ts'), 'export const value = 1;\n');
    await writeFile(join(temporaryDirectory, '.env'), 'SECRET=not-for-reading\n');
    await writeFile(join(temporaryDirectory, 'node_modules', 'hidden.js'), 'ignored');

    database = createAppDatabase(':memory:');
    const workspaces = new WorkspaceService(
      new WorkspaceRepository(database),
      new FixedDirectoryPicker(temporaryDirectory),
    );
    const workspace = await workspaces.openFromDialog();
    if (workspace === null) {
      throw new Error('Test workspace was not opened.');
    }
    workspaceId = workspace.id;
    service = new WorkspaceFileService(workspaces);
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('lists directories incrementally while hiding generated folders and protecting secrets', async () => {
    const entries = await service.listDirectory(workspaceId, '');

    expect(entries.map((entry) => entry.name)).toEqual(['src', '.env']);
    expect(entries.find((entry) => entry.name === '.env')?.restricted).toBe(true);
  });

  it('reads UTF-8 source files and opens text files larger than one megabyte', async () => {
    const largeContent = 'a'.repeat(1_200_000);
    await writeFile(join(temporaryDirectory, 'large.txt'), largeContent);

    const source = await service.readFile(workspaceId, 'src/index.ts');
    const large = await service.readFile(workspaceId, 'large.txt');

    expect(source.content).toBe('export const value = 1;\n');
    expect(source.language).toBe('typescript');
    expect(large.content).toHaveLength(1_200_000);
  });

  it('atomically saves a file and rejects a stale baseline hash', async () => {
    const original = await service.readFile(workspaceId, 'src/index.ts');
    const saved = await service.writeFile(
      workspaceId,
      'src/index.ts',
      'export const value = 2;\n',
      original.contentHash,
    );

    expect(saved.contentHash).not.toBe(original.contentHash);
    await expect(
      service.writeFile(workspaceId, 'src/index.ts', 'stale', original.contentHash),
    ).rejects.toThrow('磁盘上发生变化');
    await expect(readFile(join(temporaryDirectory, 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'export const value = 2;\n',
    );
  });

  it('denies sensitive files and searches names without reading file contents', async () => {
    await expect(service.readFile(workspaceId, '.env')).rejects.toThrow('敏感路径');

    const matches = await service.searchFiles(workspaceId, 'index', 20);
    expect(matches.map((entry) => entry.relativePath)).toEqual(['src/index.ts']);
  });
});
