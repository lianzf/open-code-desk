import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { JavaLanguageClient } from './java-language-client';

describe('JavaLanguageClient', () => {
  it('frames requests and resolves fragmented JSON-RPC responses', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new JavaLanguageClient(input, output, { workspaceFolders: [] });
    const outgoing = nextFrame(output);
    const result = client.request<{ readonly ready: boolean }>('java/test', { value: 42 });
    const request = await outgoing;
    expect(request).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'java/test' });
    const response = encodeFrame({ jsonrpc: '2.0', id: 1, result: { ready: true } });
    input.write(response.subarray(0, 7));
    input.write(response.subarray(7));
    await expect(result).resolves.toEqual({ ready: true });
    client.dispose();
  });

  it('answers workspace configuration requests without mutating the workspace', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new JavaLanguageClient(input, output, {
      workspaceFolders: [{ uri: 'file:///workspace', name: 'workspace' }],
      configuration: { java: { autobuild: { enabled: true } } },
    });
    const response = nextFrame(output);
    input.write(
      encodeFrame({
        jsonrpc: '2.0',
        id: 7,
        method: 'workspace/configuration',
        params: { items: [{ section: 'java.autobuild' }] },
      }),
    );
    await expect(response).resolves.toMatchObject({
      id: 7,
      result: [{ enabled: true }],
    });
    client.dispose();
  });
});

function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]);
}

function nextFrame(stream: PassThrough): Promise<Readonly<Record<string, unknown>>> {
  return new Promise((resolveFrame, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for JSON-RPC frame.')),
      2_000,
    );
    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const lengthMatch = /Content-Length:\s*(\d+)/iu.exec(
        buffer.subarray(0, headerEnd).toString('ascii'),
      );
      const length = Number(lengthMatch?.[1]);
      const bodyStart = headerEnd + 4;
      if (!Number.isSafeInteger(length) || buffer.length < bodyStart + length) return;
      clearTimeout(timer);
      resolveFrame(
        JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString('utf8')) as Readonly<
          Record<string, unknown>
        >,
      );
    });
  });
}
