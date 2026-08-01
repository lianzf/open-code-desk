import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppDatabase, type AppDatabase } from '../database/database';
import type { DirectoryPicker } from '../workspace/directory-picker';
import { WorkspaceRepository } from '../workspace/workspace.repository';
import { WorkspaceService } from '../workspace/workspace.service';
import { GitService } from './git.service';

const execFileAsync = promisify(execFile);

class StaticDirectoryPicker implements DirectoryPicker {
  public constructor(private readonly selectedPath: string) {}

  public async pickDirectory(): Promise<string> {
    return this.selectedPath;
  }
}

async function git(cwd: string, ...args: ReadonlyArray<string>): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

describe('GitService integration', () => {
  let rootPath: string;
  let database: AppDatabase;
  let service: GitService;
  let workspaceId: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'open-code-desk-git-'));
    await git(rootPath, 'init');
    await git(rootPath, 'checkout', '-b', 'main');
    await writeFile(join(rootPath, 'tracked.txt'), 'before\n', 'utf8');
    await writeFile(join(rootPath, '.env'), 'SECRET=initial\n', 'utf8');
    await git(rootPath, 'add', 'tracked.txt', '.env');
    await git(
      rootPath,
      '-c',
      'user.name=OpenCode Desk Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'initial',
    );

    database = createAppDatabase(':memory:');
    const workspaces = new WorkspaceService(
      new WorkspaceRepository(database),
      new StaticDirectoryPicker(rootPath),
    );
    const workspace = await workspaces.openFromDialog();
    if (workspace === null) {
      throw new Error('Expected the test workspace to open.');
    }
    workspaceId = workspace.id;
    service = new GitService(workspaces);
  });

  afterEach(async () => {
    database.close();
    await rm(rootPath, { recursive: true, force: true });
  });

  it('reads branch, staged, modified, and untracked status plus bounded diffs', async () => {
    await writeFile(join(rootPath, 'tracked.txt'), `after\n${'x'.repeat(2_000)}\n`, 'utf8');
    await writeFile(join(rootPath, 'staged.txt'), 'staged\n', 'utf8');
    await writeFile(join(rootPath, 'untracked.txt'), 'untracked\n', 'utf8');
    await writeFile(join(rootPath, '.env'), 'SECRET=must-not-appear\n', 'utf8');
    await git(rootPath, 'add', 'staged.txt');

    const status = await service.status(workspaceId);
    expect(status.isRepository).toBe(true);
    expect(status.branch).toBe('main');
    expect(status.files.find((file) => file.path === 'tracked.txt')?.modified).toBe(true);
    expect(status.files.find((file) => file.path === 'staged.txt')?.staged).toBe(true);
    expect(status.files.find((file) => file.path === 'untracked.txt')?.untracked).toBe(true);

    const workingDiff = await service.diff({
      workspaceId,
      staged: false,
      maxCharacters: 1_000,
    });
    expect(workingDiff.content).toContain('tracked.txt');
    expect(workingDiff.content).not.toContain('must-not-appear');
    expect(workingDiff.truncated).toBe(true);
    expect(workingDiff.bytes).toBeGreaterThan(workingDiff.content.length);

    const stagedDiff = await service.diff({
      workspaceId,
      staged: true,
      maxCharacters: 20_000,
    });
    expect(stagedDiff.content).toContain('staged.txt');
    expect(stagedDiff.content).toContain('+staged');
  }, 15_000);

  it('rejects an explicit sensitive path diff', async () => {
    await expect(
      service.diff({
        workspaceId,
        staged: false,
        path: '.env',
        maxCharacters: 10_000,
      }),
    ).rejects.toThrow('敏感文件');
  });
});
