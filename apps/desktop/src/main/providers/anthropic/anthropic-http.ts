import { z } from 'zod';
import type {
  ChatMessage,
  ChatRequest,
  ProviderConfig,
  ProviderContext,
} from '@open-code-desk/provider-core';

import { ProviderServiceError } from '../core/provider-error';
import { validateCustomHeader } from '../core/provider-network-policy';

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
});

export const anthropicModelListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      display_name: z.string().optional(),
    }),
  ),
});

export const anthropicContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), thinking: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
  }),
]);

export const anthropicMessageSchema = z.object({
  id: z.string().min(1),
  content: z.array(anthropicContentBlockSchema),
  stop_reason: z.string().nullable().optional(),
  usage: usageSchema,
});

export const anthropicStreamEnvelopeSchema = z
  .object({
    type: z.string().min(1),
  })
  .loose();

export const anthropicMessageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    id: z.string().min(1),
    usage: usageSchema,
  }),
});

export const anthropicContentBlockStartSchema = z.object({
  type: z.literal('content_block_start'),
  index: z.number().int().nonnegative(),
  content_block: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().default('') }),
    z.object({ type: z.literal('thinking'), thinking: z.string().default('') }),
    z.object({
      type: z.literal('tool_use'),
      id: z.string().min(1),
      name: z.string().min(1),
      input: z.unknown().optional(),
    }),
  ]),
});

export const anthropicContentBlockDeltaSchema = z.object({
  type: z.literal('content_block_delta'),
  index: z.number().int().nonnegative(),
  delta: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text_delta'), text: z.string() }),
    z.object({ type: z.literal('thinking_delta'), thinking: z.string() }),
    z.object({ type: z.literal('input_json_delta'), partial_json: z.string() }),
    z.object({ type: z.literal('signature_delta'), signature: z.string() }),
  ]),
});

export const anthropicContentBlockStopSchema = z.object({
  type: z.literal('content_block_stop'),
  index: z.number().int().nonnegative(),
});

export const anthropicMessageDeltaSchema = z.object({
  type: z.literal('message_delta'),
  delta: z.object({
    stop_reason: z.string().nullable().optional(),
  }),
  usage: z.object({
    output_tokens: z.number().int().nonnegative().default(0),
  }),
});

export const anthropicErrorEventSchema = z.object({
  type: z.literal('error'),
  error: z.object({
    type: z.string().optional(),
    message: z.string().optional(),
  }),
});

interface AnthropicContentBlock {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content: ReadonlyArray<AnthropicContentBlock>;
}

function parseToolInput(argumentsJson: string): Readonly<Record<string, unknown>> {
  let input: unknown;
  try {
    input = JSON.parse(argumentsJson) as unknown;
  } catch {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      '历史工具调用参数不是有效 JSON，无法发送给 Anthropic。',
      false,
    );
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProviderServiceError('VALIDATION_ERROR', '历史工具调用参数必须是 JSON 对象。', false);
  }
  return input as Readonly<Record<string, unknown>>;
}

function blocksForMessage(message: ChatMessage): ReadonlyArray<AnthropicContentBlock> {
  if (message.role === 'tool') {
    if (message.toolCallId === undefined) {
      throw new ProviderServiceError(
        'VALIDATION_ERROR',
        '工具结果缺少 tool call ID，无法发送给 Anthropic。',
        false,
      );
    }
    return [
      {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      },
    ];
  }

  const blocks: AnthropicContentBlock[] = [];
  if (message.content !== '') {
    blocks.push({ type: 'text', text: message.content });
  }
  for (const toolCall of message.toolCalls ?? []) {
    blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: parseToolInput(toolCall.arguments),
    });
  }
  return blocks;
}

function anthropicMessages(messages: ChatRequest['messages']): ReadonlyArray<AnthropicMessage> {
  const result: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const blocks = blocksForMessage(message);
    const previous = result.at(-1);
    if (previous?.role === role) {
      result[result.length - 1] = {
        role,
        content: [...previous.content, ...blocks],
      };
    } else {
      result.push({ role, content: blocks });
    }
  }
  return result;
}

export function buildAnthropicHeaders(context: ProviderContext): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(context.customHeaders)) {
    validateCustomHeader(name, value);
    headers.set(name, value);
  }
  if (context.apiKey !== undefined && context.apiKey !== '') {
    headers.set('x-api-key', context.apiKey);
  }
  if (!headers.has('anthropic-version')) {
    headers.set('anthropic-version', '2023-06-01');
  }
  headers.set('accept', 'application/json');
  headers.set('content-type', 'application/json');
  return headers;
}

export function anthropicRequestBody(
  request: ChatRequest,
  stream: boolean,
): Readonly<Record<string, unknown>> {
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter((content) => content !== '')
    .join('\n\n');

  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 4_096,
    messages: anthropicMessages(request.messages),
    stream,
    ...(system === '' ? {} : { system }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          })),
        }),
  };
}

export function anthropicEndpoint(config: ProviderConfig, path: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/${path}`;
}
