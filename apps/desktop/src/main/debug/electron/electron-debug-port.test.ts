import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { electronDebugPortIsOpen } from './electron-debug-port';

describe('Electron renderer debug port', () => {
  it('detects an existing loopback listener before an attach can be attempted', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Missing test port.');
      await expect(electronDebugPortIsOpen(address.port)).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
