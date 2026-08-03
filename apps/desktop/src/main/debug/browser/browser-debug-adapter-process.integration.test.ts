import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { BrowserDebugAdapterProcess } from './browser-debug-adapter-process';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('browser debug process lifecycle', () => {
  it('redacts approved secrets when the development server exits during startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open-code-desk-browser-process-'));
    temporaryDirectories.push(root);
    const serverPath = join(root, 'server.cjs');
    const port = await availablePort();
    const secret = 'browser-server-secret-value';
    await writeFile(
      serverPath,
      `process.stderr.write(${JSON.stringify(`startup failed with ${secret}`)}); process.exit(7);`,
      'utf8',
    );

    const error = await BrowserDebugAdapterProcess.start({
      adapterExecutable: process.execPath,
      adapterServerPath: join(root, 'unused-adapter.cjs'),
      serverExecutable: process.execPath,
      serverArgs: [serverPath],
      cwd: root,
      environment: {},
      sensitiveValues: [secret],
      port,
      startupTimeoutMs: 5_000,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('[REDACTED]');
    expect((error as Error).message).not.toContain(secret);
  });
});

function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a browser process test port.'));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}
