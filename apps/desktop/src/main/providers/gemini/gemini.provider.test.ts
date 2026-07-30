import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderConfig, ProviderContext } from '@open-code-desk/provider-core';

import { geminiRequestBody } from './gemini-http';
import { GeminiProvider } from './gemini.provider';

let server: Server;
let baseUrl: string;
let receivedBody = '';

const config = (): ProviderConfig => ({
  id: '0b8886fa-9dc6-4137-a856-351f844b4399',
  kind: 'gemini',
  displayName: 'Gemini fixture',
  baseUrl,
  defaultModel: 'gemini-fixture',
  capabilities: {
    streaming: true,
    toolCalling: true,
    vision: true,
    reasoning: true,
    structuredOutput: true,
    contextWindow: 1_000_000,
  },
});

const context = (): ProviderContext => ({
  requestId: 'gemini-request',
  signal: new AbortController().signal,
  apiKey: 'gemini-fixture-key',
  customHeaders: { 'X-Tenant': 'fixture' },
});

beforeEach(async () => {
  receivedBody = '';
  server = createServer((request, response) => {
    if (
      request.headers['x-goog-api-key'] !== 'gemini-fixture-key' ||
      request.headers['x-tenant'] !== 'fixture'
    ) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1beta/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-fixture',
              displayName: 'Gemini Fixture',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/embed-fixture',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
      );
      return;
    }
    if (request.url === '/v1beta/models/gemini-fixture:streamGenerateContent?alt=sse') {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        receivedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
          'data: {"responseId":"gemini-1","candidates":[{"index":0,"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
        );
        response.write(
          'data: {"responseId":"gemini-1","candidates":[{"index":0,"content":{"parts":[{"text":"Need file","thought":true},{"functionCall":{"id":"call-1","name":"read_file","args":{"path":"README.md"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":5}}\n\n',
        );
        response.end();
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/v1beta`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

describe('GeminiProvider', () => {
  it('lists only models that support content generation', async () => {
    const provider = new GeminiProvider();

    await expect(provider.listModels(config(), context())).resolves.toMatchObject([
      {
        id: 'gemini-fixture',
        name: 'Gemini Fixture',
        ownedBy: 'google',
      },
    ]);
  });

  it('streams text, thinking, function calls and usage from Gemini SSE', async () => {
    const provider = new GeminiProvider();
    const events = [];

    for await (const event of provider.streamChat(
      config(),
      {
        model: 'gemini-fixture',
        messages: [
          { role: 'system', content: 'You are a coding agent.' },
          { role: 'user', content: 'Read the README.' },
        ],
        tools: [
          {
            name: 'read_file',
            description: 'Read a workspace file',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          },
        ],
      },
      context(),
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'message_start', responseId: 'gemini-1' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'reasoning_delta', delta: 'Need file' },
      { type: 'tool_call_start', callId: 'call-1', name: 'read_file' },
      {
        type: 'tool_call_delta',
        callId: 'call-1',
        argumentsDelta: '{"path":"README.md"}',
      },
      { type: 'tool_call_end', callId: 'call-1' },
      { type: 'usage', usage: { inputTokens: 8, outputTokens: 5 } },
      { type: 'message_end', finishReason: 'STOP' },
    ]);
    expect(JSON.parse(receivedBody)).toMatchObject({
      systemInstruction: { parts: [{ text: 'You are a coding agent.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Read the README.' }] }],
      tools: [{ functionDeclarations: [{ name: 'read_file' }] }],
    });
  });

  it('links Gemini function responses to the originating tool name and call ID', () => {
    expect(
      geminiRequestBody({
        model: 'gemini-fixture',
        messages: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                name: 'read_file',
                arguments: '{"path":"README.md"}',
              },
            ],
          },
          {
            role: 'tool',
            content: '{"content":"hello"}',
            toolCallId: 'call-1',
          },
        ],
      }),
    ).toMatchObject({
      contents: [
        {
          role: 'model',
          parts: [{ functionCall: { id: 'call-1', name: 'read_file' } }],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { id: 'call-1', name: 'read_file' } }],
        },
      ],
    });
  });

  it('maps image content to Gemini inlineData parts', () => {
    expect(
      geminiRequestBody({
        model: 'gemini-fixture',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this image.' },
              { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
            ],
          },
        ],
      }),
    ).toMatchObject({
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Inspect this image.' },
            { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } },
          ],
        },
      ],
    });
  });
});
