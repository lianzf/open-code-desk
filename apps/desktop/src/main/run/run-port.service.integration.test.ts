import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { RunPortService } from './run-port.service';

describe('RunPortService integration', () => {
  it('reports occupied and released TCP ports', async () => {
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a TCP port.');

    const service = new RunPortService();
    const occupied = await service.inspect(address.port);
    expect(occupied).toMatchObject({ port: address.port, available: false });

    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error === undefined ? resolve() : reject(error))),
    );
    await expect(service.inspect(address.port)).resolves.toEqual({
      port: address.port,
      available: true,
    });
  });

  it('identifies ports assigned to an app-managed process', async () => {
    const service = new RunPortService(() => [
      {
        executionId: '4b2b637a-e5a2-4f28-a556-d5cf73b2b6cb',
        executable: 'node',
        args: ['server.js'],
        cwd: 'workspace',
        pid: 42,
        startedAt: new Date().toISOString(),
        status: 'running',
        outputBytes: 0,
        forwardedOutputBytes: 0,
        outputTruncated: false,
        outputTail: '',
        port: 43210,
      },
    ]);

    await expect(service.inspect(43210)).resolves.toMatchObject({
      port: 43210,
      available: false,
      processId: 42,
      processName: 'node',
      managedExecutionId: '4b2b637a-e5a2-4f28-a556-d5cf73b2b6cb',
    });
  });
});
