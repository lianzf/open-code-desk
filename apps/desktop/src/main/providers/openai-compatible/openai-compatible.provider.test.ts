import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { ProviderConfig, ProviderContext } from '@open-code-desk/provider-core';

import { ProviderServiceError } from '../core/provider-error';
import { OpenAICompatibleProvider } from './openai-compatible.provider';

let server: Server;
let baseUrl: string;
let receivedBody = '';

const config = (): ProviderConfig => ({
  id: '87ca4bf5-cbf3-4092-ae8e-f2af6e30daf2',
  kind: 'openai-compatible',
  displayName: 'Local fixture',
  baseUrl,
  defaultModel: 'fixture-model',
  capabilities: {
    streaming: true,
    toolCalling: true,
    vision: false,
    reasoning: false,
    structuredOutput: false,
    contextWindow: 32_000,
  },
});

const context = (apiKey = 'fixture-key'): ProviderContext => ({
  requestId: '15e299e1-d059-4c28-ae8f-b2c8a879c312',
  signal: new AbortController().signal,
  apiKey,
  customHeaders: { 'X-Tenant': 'fixture' },
});

beforeEach(async () => {
  receivedBody = '';
  server = createServer((request, response) => {
    if (
      request.headers.authorization !== 'Bearer fixture-key' ||
      request.headers['x-tenant'] !== 'fixture'
    ) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'fixture-model', owned_by: 'fixture' }] }));
      return;
    }
    if (request.url === '/v1/chat/completions') {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        receivedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"id":"chat-1","choices":[{"delta":{"content":"你"}}]}\n\n');
        response.write(
          'data: {"id":"chat-1","choices":[{"delta":{"content":"好","tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
        );
        response.write(
          'data: {"id":"chat-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
        );
        response.end('data: [DONE]\n\n');
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
});

describe('OpenAICompatibleProvider', () => {
  it('lists models and validates a real HTTP connection', async () => {
    const provider = new OpenAICompatibleProvider();

    await expect(provider.listModels(config(), context())).resolves.toMatchObject([
      { id: 'fixture-model', name: 'fixture-model', ownedBy: 'fixture' },
    ]);
    await expect(provider.validateConfig(config(), context())).resolves.toEqual({
      valid: true,
      message: '连接成功，发现 1 个模型。',
    });
  });

  it('streams text, tool fragments, usage and completion from SSE', async () => {
    const provider = new OpenAICompatibleProvider();
    const events = [];

    for await (const event of provider.streamChat(
      config(),
      {
        model: 'fixture-model',
        messages: [{ role: 'user', content: '读取 README' }],
      },
      context(),
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'message_start', responseId: 'chat-1' },
      { type: 'text_delta', delta: '你' },
      { type: 'text_delta', delta: '好' },
      { type: 'tool_call_start', callId: 'call-1', name: 'read_file' },
      {
        type: 'tool_call_delta',
        callId: 'call-1',
        argumentsDelta: '{"path":',
      },
      {
        type: 'tool_call_delta',
        callId: 'call-1',
        argumentsDelta: '"README.md"}',
      },
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
      { type: 'tool_call_end', callId: 'call-1' },
      { type: 'message_end', finishReason: 'tool_calls' },
    ]);
    expect(JSON.parse(receivedBody)).toMatchObject({
      model: 'fixture-model',
      stream: true,
    });
  });

  it('maps authentication failures without echoing credentials', async () => {
    const provider = new OpenAICompatibleProvider();

    await expect(provider.listModels(config(), context('wrong-key'))).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      retryable: false,
    } satisfies Partial<ProviderServiceError>);
    await expect(provider.listModels(config(), context('wrong-key'))).rejects.not.toThrow(
      'wrong-key',
    );
  });
});
