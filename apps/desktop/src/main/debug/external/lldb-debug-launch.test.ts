import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { RunCommandSnapshot } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createLldbLaunchArguments, isLldbDebugTarget } from './lldb-debug-launch';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('LLDB launch mapping', () => {
  it('maps a compiled workspace binary without invoking a shell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-lldb-launch-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'build'), { recursive: true });
    const binary = join(root, 'build', process.platform === 'win32' ? 'demo.exe' : 'demo');
    await writeFile(binary, 'fixture', 'utf8');
    const command = fixture(process.platform === 'win32' ? 'build\\demo.exe' : 'build/demo', 'cpp');

    await expect(createLldbLaunchArguments(command, root, { MODE: 'test' })).resolves.toMatchObject(
      {
        type: 'lldb-dap',
        request: 'launch',
        program: binary,
        args: ['--verbose', 'sample.txt'],
        cwd: root,
        env: { MODE: 'test' },
      },
    );
  });

  it('rejects build tools and missing compiled targets', async () => {
    expect(isLldbDebugTarget(fixture('cargo', 'rust'))).toBe(false);
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-lldb-missing-'));
    temporaryDirectories.push(root);
    await expect(
      createLldbLaunchArguments(fixture('build/missing', 'c'), root, {}),
    ).rejects.toThrow('compiled executable');
  });
});

function fixture(executable: string, projectType: 'c' | 'cpp' | 'rust'): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: 'LLDB fixture',
    projectType,
    executable,
    runtimeArgs: ['--verbose'],
    args: ['sample.txt'],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}
