import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { findDebugAdapterExecutable } from './external-debug-adapter-path';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('findDebugAdapterExecutable', () => {
  it('finds an adapter on the host PATH without executing it', async () => {
    const first = await mkdtemp(join(tmpdir(), 'open-code-desk-dap-empty-'));
    const second = await mkdtemp(join(tmpdir(), 'open-code-desk-dap-found-'));
    temporaryDirectories.push(first, second);
    const name = process.platform === 'win32' ? 'lldb-dap.exe' : 'lldb-dap';
    const executable = join(second, name);
    await writeFile(executable, 'must not be executed', 'utf8');

    await expect(
      findDebugAdapterExecutable(['lldb-dap'], {
        environment: { PATH: `${first}${process.platform === 'win32' ? ';' : ':'}${second}` },
      }),
    ).resolves.toBe(executable);
  });

  it('returns undefined when no candidate exists', async () => {
    await expect(
      findDebugAdapterExecutable(['lldb-dap'], {
        platform: 'linux',
        environment: { PATH: '' },
      }),
    ).resolves.toBeUndefined();
  });
});
