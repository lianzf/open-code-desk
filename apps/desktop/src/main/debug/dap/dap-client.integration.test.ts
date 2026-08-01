import { createServer, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { DapClient } from './dap-client';
import { DapFrameParser } from './dap-frame-parser';
import { encodeDapMessage, type DapMessage } from './dap-message';

const clients: DapClient[] = [];
const servers: Server[] = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.dispose());
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('DapClient integration', () => {
  it('correlates requests and receives framed events', async () => {
    const fixture = await startServer((socket, message) => {
      if (message.type !== 'request' || message.command !== 'ping') return;
      const response = encodeDapMessage({
        seq: 2,
        type: 'response',
        request_seq: message.seq,
        command: message.command,
        success: true,
        body: { pong: true },
      });
      const event = encodeDapMessage({
        seq: 3,
        type: 'event',
        event: 'ready',
        body: { state: 'ok' },
      });
      socket.write(response.subarray(0, 11));
      socket.write(Buffer.concat([response.subarray(11), event]));
    });
    const client = await DapClient.connect('127.0.0.1', fixture.port);
    clients.push(client);
    const ready = client.waitForEvent('ready');

    await expect(client.request('ping', { value: 1 })).resolves.toEqual({ pong: true });
    await expect(ready).resolves.toMatchObject({ event: 'ready', body: { state: 'ok' } });
  });

  it('handles adapter reverse requests and returns a correlated response', async () => {
    let reverseResponse: DapMessage | undefined;
    let resolveReverse: (message: DapMessage) => void = () => undefined;
    const responseReceived = new Promise<DapMessage>((resolve) => {
      resolveReverse = resolve;
    });
    const fixture = await startServer((socket, message) => {
      if (message.type === 'request' && message.command === 'ready') {
        socket.write(
          encodeDapMessage({
            seq: 10,
            type: 'response',
            request_seq: message.seq,
            command: message.command,
            success: true,
          }),
        );
        socket.write(
          encodeDapMessage({
            seq: 11,
            type: 'request',
            command: 'startDebugging',
            arguments: { request: 'launch' },
          }),
        );
      } else if (message.type === 'response' && message.request_seq === 11) {
        reverseResponse = message;
        resolveReverse(message);
      }
    });
    const client = await DapClient.connect('127.0.0.1', fixture.port);
    clients.push(client);
    client.onReverseRequest(async (command, argumentsValue) => ({
      accepted: command === 'startDebugging',
      argumentsValue,
    }));

    await client.request('ready');
    await responseReceived;
    expect(reverseResponse).toMatchObject({
      type: 'response',
      request_seq: 11,
      command: 'startDebugging',
      success: true,
      body: { accepted: true, argumentsValue: { request: 'launch' } },
    });
  });
});

async function startServer(
  onMessage: (socket: Socket, message: DapMessage) => void,
): Promise<{ readonly port: number }> {
  const server = createServer((socket) => {
    const parser = new DapFrameParser();
    socket.on('data', (chunk) => {
      for (const message of parser.push(chunk)) onMessage(socket, message);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing DAP test port.');
  return { port: address.port };
}
