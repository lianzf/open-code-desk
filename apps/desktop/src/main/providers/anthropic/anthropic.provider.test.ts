import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderConfig, ProviderContext } from '@open-code-desk/provider-core';

import { anthropicRequestBody } from './anthropic-http';
import { AnthropicProvider } from './anthropic.provider';

let server: Server;
let baseUrl: string;
let receivedBody = '';

const config = (): ProviderConfig => ({
  id: 'd5a35b65-3c6a-4cf3-a2dc-c2f2973d44a5',
  kind: 'anthropic',
  displayName: 'Anthropic fixture',
  baseUrl,
  defaultModel: 'claude-fixture',
  capabilities: {
    streaming: true,
    toolCalling: true,
    vision: true,
    reasoning: true,
    structuredOutput: false,
    contextWindow: 200_000,
  },
});

const context = (): ProviderContext => ({
  requestId: 'anthropic-request',
  signal: new AbortController().signal,
  apiKey: 'anthropic-fixture-key',
  customHeaders: { 'X-Tenant': 'fixture' },
});

beforeEach(async () => {
  receivedBody = '';
  server = createServer((request, response) => {
    if (
      request.headers['x-api-key'] !== 'anthropic-fixture-key' ||
      request.headers['anthropic-version'] !== '2023-06-01' ||
      request.headers['x-tenant'] !== 'fixture'
    ) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          data: [{ id: 'claude-fixture', display_name: 'Claude Fixture' }],
        }),
      );
      return;
    }
    if (request.url === '/v1/messages') {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        receivedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
          'data: {"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":9,"output_tokens":0}}}\n\n',
        );
        response.write(
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        );
        response.write(
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        );
        response.write('data: {"type":"content_block_stop","index":0}\n\n');
        response.write(
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu-1","name":"read_file","input":{}}}\n\n',
        );
        response.write(
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
        );
        response.write(
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"README.md\\"}"}}\n\n',
        );
        response.write('data: {"type":"content_block_stop","index":1}\n\n');
        response.write(
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}\n\n',
        );
        response.end('data: {"type":"message_stop"}\n\n');
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
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

describe('AnthropicProvider', () => {
  it('lists models using Anthropic authentication headers', async () => {
    const provider = new AnthropicProvider();

    await expect(provider.listModels(config(), context())).resolves.toMatchObject([
      {
        id: 'claude-fixture',
        name: 'Claude Fixture',
        ownedBy: 'anthropic',
      },
    ]);
  });

  it('streams text, tool arguments and usage from Anthropic SSE', async () => {
    const provider = new AnthropicProvider();
    const events = [];

    for await (const event of provider.streamChat(
      config(),
      {
        model: 'claude-fixture',
        messages: [
          { role: 'system', content: 'You are a coding agent.' },
          { role: 'user', content: 'Read the README.' },
        ],
        tools: [
          {
            name: 'read_file',
            description: 'Read a workspace file',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      },
      context(),
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'message_start', responseId: 'msg-1' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'tool_call_start', callId: 'toolu-1', name: 'read_file' },
      { type: 'tool_call_delta', callId: 'toolu-1', argumentsDelta: '{"path":' },
      { type: 'tool_call_delta', callId: 'toolu-1', argumentsDelta: '"README.md"}' },
      { type: 'tool_call_end', callId: 'toolu-1' },
      { type: 'usage', usage: { inputTokens: 9, outputTokens: 4 } },
      { type: 'message_end', finishReason: 'tool_use' },
    ]);
    expect(JSON.parse(receivedBody)).toMatchObject({
      model: 'claude-fixture',
      max_tokens: 4096,
      stream: true,
      system: 'You are a coding agent.',
      tools: [{ name: 'read_file' }],
    });
  });

  it('converts assistant tool calls and tool results to Anthropic content blocks', () => {
    expect(
      anthropicRequestBody(
        {
          model: 'claude-fixture',
          messages: [
            {
              role: 'assistant',
              content: '',
              toolCalls: [
                {
                  id: 'toolu-1',
                  name: 'read_file',
                  arguments: '{"path":"README.md"}',
                },
              ],
            },
            {
              role: 'tool',
              content: '{"content":"hello"}',
              toolCallId: 'toolu-1',
            },
          ],
        },
        false,
      ),
    ).toMatchObject({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu-1', name: 'read_file' }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu-1' }],
        },
      ],
    });
  });

  it('maps image content to Anthropic base64 image blocks', () => {
    expect(
      anthropicRequestBody(
        {
          model: 'claude-fixture',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Inspect this image.' },
                { type: 'image', mediaType: 'image/webp', data: 'aGVsbG8=' },
              ],
            },
          ],
        },
        false,
      ),
    ).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this image.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/webp',
                data: 'aGVsbG8=',
              },
            },
          ],
        },
      ],
    });
  });
});
