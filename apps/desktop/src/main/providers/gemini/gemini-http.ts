import { z } from 'zod';
import type {
  ChatMessageContent,
  ChatMessage,
  ChatRequest,
  ProviderConfig,
  ProviderContext,
} from '@open-code-desk/provider-core';

import { ProviderServiceError } from '../core/provider-error';
import { validateCustomHeader } from '../core/provider-network-policy';

export const geminiModelListSchema = z.object({
  models: z.array(
    z.object({
      name: z.string().min(1),
      displayName: z.string().optional(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
});

export const geminiPartSchema = z
  .object({
    text: z.string().optional(),
    thought: z.boolean().optional(),
    functionCall: z
      .object({
        id: z.string().optional(),
        name: z.string().min(1),
        args: z.record(z.string(), z.unknown()).default({}),
      })
      .optional(),
  })
  .loose();

export const geminiResponseSchema = z.object({
  responseId: z.string().optional(),
  candidates: z
    .array(
      z.object({
        index: z.number().int().nonnegative().optional(),
        content: z.object({
          parts: z.array(geminiPartSchema).default([]),
        }),
        finishReason: z.string().optional(),
      }),
    )
    .default([]),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().default(0),
      candidatesTokenCount: z.number().int().nonnegative().default(0),
    })
    .optional(),
});

interface GeminiPart {
  readonly [key: string]: unknown;
}

interface GeminiContent {
  readonly role: 'user' | 'model';
  readonly parts: ReadonlyArray<GeminiPart>;
}

function textContentOf(content: ChatMessageContent): string {
  return typeof content === 'string'
    ? content
    : content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
}

function parseFunctionArguments(argumentsJson: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson) as unknown;
  } catch {
    throw new ProviderServiceError(
      'VALIDATION_ERROR',
      '历史工具调用参数不是有效 JSON，无法发送给 Gemini。',
      false,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProviderServiceError('VALIDATION_ERROR', '历史工具调用参数必须是 JSON 对象。', false);
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function pushContent(
  result: GeminiContent[],
  role: GeminiContent['role'],
  parts: GeminiPart[],
): void {
  const previous = result.at(-1);
  if (previous?.role === role) {
    result[result.length - 1] = {
      role,
      parts: [...previous.parts, ...parts],
    };
  } else {
    result.push({ role, parts });
  }
}

function partsForMessage(
  message: ChatMessage,
  toolNames: ReadonlyMap<string, string>,
): ReadonlyArray<GeminiPart> {
  if (message.role === 'tool') {
    if (message.toolCallId === undefined) {
      throw new ProviderServiceError(
        'VALIDATION_ERROR',
        '工具结果缺少 tool call ID，无法发送给 Gemini。',
        false,
      );
    }
    const name = toolNames.get(message.toolCallId);
    if (name === undefined) {
      throw new ProviderServiceError(
        'VALIDATION_ERROR',
        '工具结果找不到对应的工具名称，无法发送给 Gemini。',
        false,
      );
    }
    return [
      {
        functionResponse: {
          id: message.toolCallId,
          name,
          response: { output: textContentOf(message.content) },
        },
      },
    ];
  }

  const parts: GeminiPart[] = [];
  const contentParts =
    typeof message.content === 'string'
      ? message.content === ''
        ? []
        : [{ type: 'text' as const, text: message.content }]
      : message.content;
  for (const part of contentParts) {
    parts.push(
      part.type === 'text'
        ? { text: part.text }
        : { inlineData: { mimeType: part.mediaType, data: part.data } },
    );
  }
  for (const toolCall of message.toolCalls ?? []) {
    parts.push({
      functionCall: {
        id: toolCall.id,
        name: toolCall.name,
        args: parseFunctionArguments(toolCall.arguments),
      },
    });
  }
  return parts;
}

function geminiContents(messages: ChatRequest['messages']): ReadonlyArray<GeminiContent> {
  const result: GeminiContent[] = [];
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      toolNames.set(toolCall.id, toolCall.name);
    }
    if (message.role === 'system') {
      continue;
    }
    const role = message.role === 'assistant' ? 'model' : 'user';
    pushContent(result, role, [...partsForMessage(message, toolNames)]);
  }
  return result;
}

export function buildGeminiHeaders(context: ProviderContext): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(context.customHeaders)) {
    validateCustomHeader(name, value);
    headers.set(name, value);
  }
  if (context.apiKey !== undefined && context.apiKey !== '') {
    headers.set('x-goog-api-key', context.apiKey);
  }
  headers.set('accept', 'application/json');
  headers.set('content-type', 'application/json');
  return headers;
}

export function geminiRequestBody(request: ChatRequest): Readonly<Record<string, unknown>> {
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => textContentOf(message.content))
    .filter((content) => content !== '')
    .join('\n\n');

  return {
    contents: geminiContents(request.messages),
    ...(system === ''
      ? {}
      : {
          systemInstruction: {
            parts: [{ text: system }],
          },
        }),
    ...(request.tools === undefined
      ? {}
      : {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              })),
            },
          ],
        }),
    ...(request.temperature === undefined && request.maxOutputTokens === undefined
      ? {}
      : {
          generationConfig: {
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: request.maxOutputTokens }),
          },
        }),
  };
}

export function geminiModelsEndpoint(config: ProviderConfig): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/models`;
}

export function geminiGenerateEndpoint(
  config: ProviderConfig,
  model: string,
  stream: boolean,
): string {
  const modelId = encodeURIComponent(model.replace(/^models\//, ''));
  const operation = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  return `${config.baseUrl.replace(/\/+$/, '')}/models/${modelId}:${operation}`;
}
