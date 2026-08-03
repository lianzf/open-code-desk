import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { DefaultPermissionPolicy, ToolDispatcher } from '@open-code-desk/tool-core';

import { createAppDatabase } from '../database/database';
import { WorkspaceFileService } from '../filesystem/workspace-file.service';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { createReadOnlyToolRegistry } from './register-read-only-tools';

const temporaryPaths: string[] = [];
const picker: DirectoryPicker = {
  async pickDirectory() {
    return null;
  },
};

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => rm(temporaryPath, { recursive: true, force: true })),
  );
});

describe('read-only Agent tools', () => {
  it('reads and searches real workspace files while denying sensitive files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-code-desk-tools-'));
    temporaryPaths.push(directory);
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'src', 'answer.ts'), 'export const answer = 42;\n', 'utf8');
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'vitest' } }),
      'utf8',
    );
    await writeFile(join(directory, '.env'), 'TOKEN=never-read', 'utf8');

    const database = createAppDatabase(':memory:');
    const workspaceRepository = new WorkspaceRepository(database);
    const workspace = workspaceRepository.upsert(await realpath(directory));
    const workspaceService = new WorkspaceService(workspaceRepository, picker);
    await workspaceService.openRecent(workspace.id);
    const fileService = new WorkspaceFileService(workspaceService);
    const registry = createReadOnlyToolRegistry(fileService);
    const dispatcher = new ToolDispatcher(registry, new DefaultPermissionPolicy(), {
      async started() {},
      async completed() {},
    });
    const context = {
      workspaceId: workspace.id,
      conversationId: randomUUID(),
      taskId: randomUUID(),
      callId: randomUUID(),
      signal: new AbortController().signal,
    };

    await expect(
      dispatcher.execute('read_file', { path: 'src/answer.ts' }, context),
    ).resolves.toMatchObject({
      ok: true,
      value: { content: 'export const answer = 42;\n' },
    });
    await expect(
      dispatcher.execute('search_text', { query: 'answer = 42' }, context),
    ).resolves.toMatchObject({
      ok: true,
      value: { matches: [{ path: 'src/answer.ts', line: 1 }] },
    });
    await expect(dispatcher.execute('inspect_package', {}, context)).resolves.toMatchObject({
      ok: true,
      value: { name: 'fixture', scripts: { test: 'vitest' } },
    });
    await expect(dispatcher.execute('read_file', { path: '.env' }, context)).resolves.toMatchObject(
      {
        ok: false,
        error: { code: 'TOOL_EXECUTION_FAILED' },
      },
    );
    database.close();
  });
});
