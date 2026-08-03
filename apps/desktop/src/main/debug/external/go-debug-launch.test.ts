import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { RunCommandSnapshot } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createGoLaunchArguments, isGoDebugTarget } from './go-debug-launch';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Go launch mapping', () => {
  it('maps the default go run package to Delve debug mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-go-launch-'));
    temporaryDirectories.push(root);
    await writeFile(join(root, 'go.mod'), 'module example.invalid/demo\n', 'utf8');

    await expect(
      createGoLaunchArguments(fixture('go', ['run', '.']), root, { MODE: 'test' }),
    ).resolves.toMatchObject({
      type: 'go',
      request: 'launch',
      mode: 'debug',
      program: root,
      args: [],
      cwd: root,
      env: { MODE: 'test' },
    });
  });

  it('maps a compiled binary to Delve exec mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-go-exec-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'bin'));
    const binary = join(root, 'bin', process.platform === 'win32' ? 'demo.exe' : 'demo');
    await writeFile(binary, 'compiled fixture', 'utf8');

    await expect(
      createGoLaunchArguments(fixture(binary, ['--verbose']), root, {}),
    ).resolves.toMatchObject({
      mode: 'exec',
      program: binary,
      args: ['--verbose'],
    });
  });

  it('rejects ambiguous go run build flags', () => {
    expect(isGoDebugTarget(fixture('go', ['run', '-race', '.']))).toBe(false);
  });
});

function fixture(executable: string, args: ReadonlyArray<string>): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'Go fixture',
    projectType: 'go',
    executable,
    runtimeArgs: [],
    args,
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}
