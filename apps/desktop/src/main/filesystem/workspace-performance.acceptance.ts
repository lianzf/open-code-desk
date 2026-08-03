import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { createAppDatabase } from '../database/database';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceFileService } from './workspace-file.service';

const directoryCount = 100;
const filesPerDirectory = 100;
const totalFiles = directoryCount * filesPerDirectory;
const fixtureContent = 'export const acceptanceValue = 1;\n';

class FixedDirectoryPicker implements DirectoryPicker {
  public constructor(private readonly directory: string) {}

  public async pickDirectory(): Promise<string> {
    return this.directory;
  }
}

describe('10,000-file workspace performance acceptance', () => {
  it('keeps the tree incremental, name search bounded, and text search cancellable', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'open-code-desk-performance-'));
    const database = createAppDatabase(':memory:');
    try {
      const fixtureStartedAt = performance.now();
      await createFixture(workspaceRoot);
      const fixtureCreationMs = performance.now() - fixtureStartedAt;

      const workspaces = new WorkspaceService(
        new WorkspaceRepository(database),
        new FixedDirectoryPicker(workspaceRoot),
      );
      const workspace = await workspaces.openFromDialog();
      if (workspace === null) throw new Error('Performance workspace was not opened.');
      const service = new WorkspaceFileService(workspaces);

      const memoryBefore = process.memoryUsage();
      const treeStartedAt = performance.now();
      const rootEntries = await service.listDirectory(workspace.id, '');
      const rootDirectoryMs = performance.now() - treeStartedAt;
      const memoryAfterTree = process.memoryUsage();

      const searchStartedAt = performance.now();
      const matches = await service.searchFiles(workspace.id, 'file-099.ts', 200);
      const nameSearchMs = performance.now() - searchStartedAt;

      const filenameController = new AbortController();
      filenameController.abort();
      await expect(
        service.searchFiles(workspace.id, 'file', 200, filenameController.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });

      const controller = new AbortController();
      controller.abort();
      const cancellationStartedAt = performance.now();
      await expect(
        service.searchText(workspace.id, 'acceptanceValue', '', false, 200, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' });
      const cancelledSearchMs = performance.now() - cancellationStartedAt;

      const heapGrowthBytes = Math.max(0, memoryAfterTree.heapUsed - memoryBefore.heapUsed);
      const rssGrowthBytes = Math.max(0, memoryAfterTree.rss - memoryBefore.rss);
      const result = {
        totalFiles,
        rootEntries: rootEntries.length,
        fixtureCreationMs: round(fixtureCreationMs),
        rootDirectoryMs: round(rootDirectoryMs),
        nameSearchMs: round(nameSearchMs),
        cancelledSearchMs: round(cancelledSearchMs),
        nameMatches: matches.length,
        heapGrowthBytes,
        rssGrowthBytes,
      };
      console.info(`PERFORMANCE_ACCEPTANCE ${JSON.stringify(result)}`);

      expect(rootEntries).toHaveLength(directoryCount);
      expect(rootEntries.every((entry) => entry.kind === 'directory')).toBe(true);
      expect(matches).toHaveLength(directoryCount);
      expect(rootDirectoryMs).toBeLessThan(5_000);
      expect(nameSearchMs).toBeLessThan(15_000);
      expect(cancelledSearchMs).toBeLessThan(1_000);
      expect(heapGrowthBytes).toBeLessThan(64 * 1024 * 1024);
      expect(rssGrowthBytes).toBeLessThan(128 * 1024 * 1024);
    } finally {
      database.close();
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function createFixture(workspaceRoot: string): Promise<void> {
  const batchSize = 10;
  for (let batchStart = 0; batchStart < directoryCount; batchStart += batchSize) {
    const batchEnd = Math.min(directoryCount, batchStart + batchSize);
    await Promise.all(
      Array.from({ length: batchEnd - batchStart }, async (_, offset) => {
        const directoryIndex = batchStart + offset;
        const directory = join(workspaceRoot, `directory-${formatIndex(directoryIndex)}`);
        await mkdir(directory);
        await Promise.all(
          Array.from({ length: filesPerDirectory }, (_, fileIndex) =>
            writeFile(join(directory, `file-${formatIndex(fileIndex)}.ts`), fixtureContent, 'utf8'),
          ),
        );
      }),
    );
  }
}

function formatIndex(value: number): string {
  return value.toString().padStart(3, '0');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
