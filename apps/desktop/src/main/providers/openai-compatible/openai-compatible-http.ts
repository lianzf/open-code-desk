import { z } from 'zod';
import type {
  ChatMessageContent,
  ChatRequest,
  ProviderConfig,
  ProviderContext,
} from '@open-code-desk/provider-core';

import {
  errorForHttpStatus,
  normalizeProviderError,
  ProviderServiceError,
} from '../core/provider-error';
import { assertSafeProviderEndpoint, validateCustomHeader } from '../core/provider-network-policy';

export const modelListResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      owned_by: z.string().optional(),
    }),
  ),
});

const toolCallDeltaSchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string().optional(),
  function: z
    .object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
});

export const streamChunkSchema = z.object({
  id: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullable().optional(),
            reasoning_content: z.string().nullable().optional(),
            tool_calls: z.array(toolCallDeltaSchema).optional(),
          })
          .default({}),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .default([]),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().default(0),
      completion_tokens: z.number().int().nonnegative().default(0),
    })
    .nullable()
    .optional(),
});

export const chatCompletionSchema = z.object({
  id: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().optional(),
        reasoning_content: z.string().nullable().optional(),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .optional(),
      }),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().default(0),
      completion_tokens: z.number().int().nonnegative().default(0),
    })
    .optional(),
});

export interface ToolCallAccumulator {
  readonly callId: string;
  name: string;
  started: boolean;
}

const maximumJsonResponseBytes = 2_000_000;
const requestTimeoutMs = 30_000;
const maximumJsonResponseDurationMs = 30_000;

export interface ResponseReadOptions {
  readonly maximumBytes?: number;
  readonly idleTimeoutMs?: number;
  readonly maximumDurationMs?: number;
  readonly signal?: AbortSignal;
}

function responseBodyTimeoutError(): ProviderServiceError {
  return new ProviderServiceError(
    'PROVIDER_UNAVAILABLE',
    '模型服务响应体超过最长读取时间。请检查网络和服务状态后重试。',
    true,
  );
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    if (signal?.aborted === true) {
      throw signal.reason;
    }
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new ProviderServiceError(
              'PROVIDER_UNAVAILABLE',
              '模型服务响应体超时。请检查网络和服务状态后重试。',
              true,
            ),
          );
        }, idleTimeoutMs);
      }),
      ...(signal === undefined
        ? []
        : [
            new Promise<never>((_resolve, reject) => {
              abortListener = () => reject(signal.reason);
              signal.addEventListener('abort', abortListener, { once: true });
            }),
          ]),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (abortListener !== undefined && signal !== undefined) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

function openAIContent(content: ChatMessageContent): unknown {
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : {
          type: 'image_url',
          image_url: { url: `data:${part.mediaType};base64,${part.data}` },
        },
  );
}

export function endpoint(config: ProviderConfig, path: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/${path}`;
}

export function buildHeaders(context: ProviderContext): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(context.customHeaders)) {
    validateCustomHeader(name, value);
    headers.set(name, value);
  }
  if (context.apiKey !== undefined && context.apiKey !== '') {
    headers.set('Authorization', `Bearer ${context.apiKey}`);
  }
  headers.set('Accept', 'application/json');
  headers.set('Content-Type', 'application/json');
  return headers;
}

export function requestBody(
  request: ChatRequest,
  stream: boolean,
): Readonly<Record<string, unknown>> {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: openAIContent(message.content),
      ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
      ...(message.toolCalls === undefined
        ? {}
        : {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: toolCall.arguments,
              },
            })),
          }),
    })),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }),
  };
}

export async function fetchWithHeaderTimeout(
  input: string,
  init: RequestInit,
  parentSignal: AbortSignal,
): Promise<Response> {
  await assertSafeProviderEndpoint(input);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(new DOMException('Provider request timed out', 'TimeoutError'));
  }, requestTimeoutMs);
  try {
    return await fetch(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([parentSignal, timeoutController.signal]),
    });
  } catch (error) {
    throw normalizeProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readLimitedJson(
  response: Response,
  options: ResponseReadOptions = {},
): Promise<unknown> {
  const maximumBytes = options.maximumBytes ?? maximumJsonResponseBytes;
  const idleTimeoutMs = options.idleTimeoutMs ?? requestTimeoutMs;
  const maximumDurationMs = options.maximumDurationMs ?? maximumJsonResponseDurationMs;
  const deadline = Date.now() + maximumDurationMs;
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > maximumBytes) {
    throw new ProviderServiceError(
      'PROVIDER_UNAVAILABLE',
      '模型服务返回的数据超过安全限制。',
      false,
    );
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  if (reader !== undefined) {
    try {
      while (true) {
        const remainingDurationMs = deadline - Date.now();
        if (remainingDurationMs <= 0) {
          throw responseBodyTimeoutError();
        }
        const chunk = await readWithIdleTimeout(
          reader,
          Math.min(idleTimeoutMs, remainingDurationMs),
          options.signal,
        );
        if (chunk.done) {
          break;
        }
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > maximumBytes) {
          throw new ProviderServiceError(
            'PROVIDER_UNAVAILABLE',
            '模型服务返回的数据超过安全限制。',
            false,
          );
        }
        chunks.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  const text = Buffer.concat(chunks, receivedBytes).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderServiceError(
      'PROVIDER_UNAVAILABLE',
      '模型服务返回了无法解析的 JSON。请检查 Base URL 是否指向 OpenAI 兼容 API。',
      false,
    );
  }
}

export function assertSuccessful(response: Response): void {
  if (!response.ok) {
    throw errorForHttpStatus(response.status);
  }
}
