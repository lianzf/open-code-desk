import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverPythonInterpreters } from './python-interpreter-discovery';

const temporaryDirectories: string[] = [];

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'open-code-desk-python-runtime-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('discoverPythonInterpreters', () => {
  it('prefers a workspace virtual environment and reads its version without executing it', async () => {
    const root = await temporaryWorkspace();
    const executable = join(root, '.venv', 'bin', 'python');
    await mkdir(join(root, '.venv', 'bin'), { recursive: true });
    await writeFile(executable, 'not an executable and must never be launched', 'utf8');
    await writeFile(join(root, '.venv', 'pyvenv.cfg'), 'version = 3.12.7\n', 'utf8');

    const candidates = await discoverPythonInterpreters(root, {
      platform: 'linux',
      environment: { PATH: '' },
    });

    expect(candidates[0]).toMatchObject({
      executable,
      source: 'workspace-venv',
      available: true,
      recommended: true,
      version: '3.12.7',
    });
  });

  it('deduplicates active and PATH candidates while preserving priority', async () => {
    const root = await temporaryWorkspace();
    const environmentRoot = join(root, 'shared-environment');
    const executable = join(environmentRoot, 'bin', 'python');
    await mkdir(join(environmentRoot, 'bin'), { recursive: true });
    await writeFile(executable, '', 'utf8');

    const candidates = await discoverPythonInterpreters(root, {
      platform: 'linux',
      environment: {
        VIRTUAL_ENV: environmentRoot,
        PATH: join(environmentRoot, 'bin'),
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      executable,
      source: 'active-environment',
      recommended: true,
    });
  });

  it('returns an explicit unverified fallback instead of claiming a runtime exists', async () => {
    const root = await temporaryWorkspace();
    await expect(
      discoverPythonInterpreters(root, { platform: 'linux', environment: { PATH: '' } }),
    ).resolves.toEqual([
      expect.objectContaining({
        executable: 'python3',
        source: 'fallback',
        available: false,
        recommended: true,
      }),
    ]);
  });

  it('returns English labels and reasons when the locale is en-US', async () => {
    const root = await temporaryWorkspace();
    const executable = join(root, '.venv', 'bin', 'python');
    await mkdir(join(root, '.venv', 'bin'), { recursive: true });
    await writeFile(executable, '', 'utf8');

    const candidates = await discoverPythonInterpreters(root, {
      platform: 'linux',
      environment: { PATH: '' },
      locale: 'en-US',
    });

    expect(candidates[0]).toMatchObject({
      label: '.venv virtual environment',
      reason:
        'Workspace virtual environments are preferred to reduce dependency and interpreter mismatches.',
    });
    expect(`${candidates[0]?.label} ${candidates[0]?.reason}`).not.toMatch(/\p{Script=Han}/u);
  });
});
