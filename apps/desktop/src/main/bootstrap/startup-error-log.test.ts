import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { recordStartupFailure } from './startup-error-log';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('startup failure logging', () => {
  it('persists a bounded redacted fallback record before application services exist', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'open-code-desk-startup-log-'));
    temporaryPaths.push(userDataPath);
    const error = new Error(`database failed with Bearer ${'s'.repeat(24)}`);

    const record = recordStartupFailure(userDataPath, error, new Date('2026-08-03T00:00:00Z'));

    expect(record.logPath).toBe(join(userDataPath, 'startup-errors.log'));
    expect(record.message).toContain('database failed');
    expect(record.message).not.toContain('s'.repeat(24));
    const stored = await readFile(record.logPath!, 'utf8');
    expect(stored).toContain('startup_failed');
    expect(stored).toContain('[REDACTED]');
    expect(stored).not.toContain('s'.repeat(24));
  });

  it('keeps the actionable prompt message when the fallback log cannot be written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-startup-log-failure-'));
    temporaryPaths.push(root);
    const fileInsteadOfDirectory = join(root, 'not-a-directory');
    await writeFile(fileInsteadOfDirectory, 'occupied', 'utf8');

    expect(recordStartupFailure(fileInsteadOfDirectory, new Error('database unavailable'))).toEqual(
      {
        message: 'database unavailable',
      },
    );
  });
});
