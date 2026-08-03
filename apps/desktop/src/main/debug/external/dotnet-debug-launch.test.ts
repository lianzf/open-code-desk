import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { RunCommandSnapshot } from '@open-code-desk/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { createDotnetLaunchArguments, isDotnetDebugTarget } from './dotnet-debug-launch';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('.NET launch mapping', () => {
  it('maps a compiled assembly to a coreclr launch request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-dotnet-launch-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'bin'));
    const assembly = join(root, 'bin', 'Demo.dll');
    await writeFile(assembly, 'compiled fixture', 'utf8');

    await expect(
      createDotnetLaunchArguments(fixture('bin/Demo.dll'), root, { MODE: 'test' }),
    ).resolves.toMatchObject({
      type: 'coreclr',
      request: 'launch',
      program: assembly,
      args: ['--verbose'],
      cwd: root,
      env: { MODE: 'test' },
    });
  });

  it('rejects dotnet build and run commands', () => {
    expect(isDotnetDebugTarget(fixture('dotnet'))).toBe(false);
  });
});

function fixture(executable: string): RunCommandSnapshot {
  return {
    configurationId: '00000000-0000-4000-8000-000000000001',
    configurationUpdatedAt: new Date().toISOString(),
    configurationName: '.NET fixture',
    projectType: 'dotnet',
    executable,
    runtimeArgs: [],
    args: ['--verbose'],
    workingDirectory: '',
    environmentVariables: [],
    console: 'runOutput',
  };
}
