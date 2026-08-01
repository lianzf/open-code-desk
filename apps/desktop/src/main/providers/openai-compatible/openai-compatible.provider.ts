import type {
  ChatRequest,
  ChatStreamEvent,
  ModelCapabilities,
  ModelInfo,
  ModelProvider,
  ProviderConfig,
  ProviderContext,
  ProviderKind,
  ValidationResult,
} from '@open-code-desk/provider-core';

import { ProviderServiceError } from '../core/provider-error';
import { resolveModelCapabilities } from '../core/model-capabilities';
import {
  assertSuccessful,
  buildHeaders,
  chatCompletionSchema,
  endpoint,
  fetchWithHeaderTimeout,
  modelListResponseSchema,
  readLimitedJson,
  requestBody,
  streamChunkSchema,
  type ToolCallAccumulator,
} from './openai-compatible-http';
import { parseServerSentEvents } from './sse-parser';

const maximumStreamBytes = 10_000_000;

export interface OpenAIProtocolProviderOptions {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly kind: ProviderKind;

  public constructor(
    options: OpenAIProtocolProviderOptions = {
      id: 'openai-compatible',
      name: 'OpenAI Compatible',
      kind: 'openai-compatible',
    },
  ) {
    this.id = options.id;
    this.name = options.name;
    this.kind = options.kind;
  }

  public async validateConfig(
    config: ProviderConfig,
    context: ProviderContext,
  ): Promise<ValidationResult> {
    const models = await this.listModels(config, context);
    return {
      valid: true,
      message:
        models.length === 0
          ? '连接成功，但服务未返回可用模型。'
          : `连接成功，发现 ${models.length} 个模型。`,
    };
  }

  public async listModels(
    config: ProviderConfig,
    context: ProviderContext,
  ): Promise<ReadonlyArray<ModelInfo>> {
    const response = await fetchWithHeaderTimeout(
      endpoint(config, 'models'),
      {
        method: 'GET',
        headers: buildHeaders(context),
      },
      context.signal,
    );
    assertSuccessful(response);
    const parsed = modelListResponseSchema.safeParse(await readLimitedJson(response));
    if (!parsed.success) {
      throw new ProviderServiceError(
        'PROVIDER_UNAVAILABLE',
        '模型列表响应格式不兼容。请确认服务实现了 OpenAI GET /models 接口。',
        false,
      );
    }
    return parsed.data.data.map((model) => ({
      id: model.id,
      name: model.id,
      ...(model.owned_by === undefined ? {} : { ownedBy: model.owned_by }),
      capabilities: resolveModelCapabilities(config, model.id),
    }));
  }

  public async *streamChat(
    config: ProviderConfig,
    request: ChatRequest,
    context: ProviderContext,
  ): AsyncIterable<ChatStreamEvent> {
    if (!config.capabilities.streaming) {
      yield* this.completeChat(config, request, context);
      return;
    }

    const response = await fetchWithHeaderTimeout(
      endpoint(config, 'chat/completions'),
      {
        method: 'POST',
        headers: buildHeaders(context),
        body: JSON.stringify(requestBody(request, true)),
      },
      context.signal,
    );
    assertSuccessful(response);
    if (response.body === null) {
      throw new ProviderServiceError(
        'PROVIDER_UNAVAILABLE',
        '模型服务没有返回流式响应正文。',
        true,
      );
    }

    let responseId = context.requestId;
    let started = false;
    let ended = false;
    let finishReason = 'stop';
    let receivedBytes = 0;
    const toolCalls = new Map<number, ToolCallAccumulator>();

    for await (const data of parseServerSentEvents(response.body, context.signal)) {
      receivedBytes += Buffer.byteLength(data);
      if (receivedBytes > maximumStreamBytes) {
        throw new ProviderServiceError(
          'PROVIDER_UNAVAILABLE',
          '模型服务的流式响应超过 10 MB 安全限制，生成已停止。',
          false,
        );
      }
      if (data === '[DONE]') {
        break;
      }
      let untrustedChunk: unknown;
      try {
        untrustedChunk = JSON.parse(data) as unknown;
      } catch {
        throw new ProviderServiceError(
          'PROVIDER_UNAVAILABLE',
          '模型服务返回了无法解析的流式数据。',
          false,
        );
      }
      const parsed = streamChunkSchema.safeParse(untrustedChunk);
      if (!parsed.success) {
        throw new ProviderServiceError(
          'PROVIDER_UNAVAILABLE',
          '模型服务返回了不兼容的流式事件。',
          false,
        );
      }
      const chunk = parsed.data;
      responseId = chunk.id ?? responseId;
      if (!started) {
        started = true;
        yield { type: 'message_start', responseId };
      }

      for (const choice of chunk.choices) {
        if (
          choice.delta.reasoning_content !== undefined &&
          choice.delta.reasoning_content !== null
        ) {
          yield { type: 'reasoning_delta', delta: choice.delta.reasoning_content };
        }
        if (choice.delta.content !== undefined && choice.delta.content !== null) {
          yield { type: 'text_delta', delta: choice.delta.content };
        }
        for (const toolDelta of choice.delta.tool_calls ?? []) {
          let accumulator = toolCalls.get(toolDelta.index);
          if (accumulator === undefined) {
            accumulator = {
              callId: toolDelta.id ?? `tool-${toolDelta.index}`,
              name: '',
              started: false,
            };
            toolCalls.set(toolDelta.index, accumulator);
          }
          if (toolDelta.function?.name !== undefined) {
            accumulator.name += toolDelta.function.name;
          }
          if (toolDelta.function?.arguments !== undefined) {
            if (!accumulator.started && accumulator.name !== '') {
              accumulator.started = true;
              yield {
                type: 'tool_call_start',
                callId: accumulator.callId,
                name: accumulator.name,
              };
            }
            yield {
              type: 'tool_call_delta',
              callId: accumulator.callId,
              argumentsDelta: toolDelta.function.arguments,
            };
          }
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          finishReason = choice.finish_reason;
        }
      }

      if (chunk.usage !== undefined && chunk.usage !== null) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          },
        };
      }
    }

    for (const toolCall of toolCalls.values()) {
      if (!toolCall.started && toolCall.name !== '') {
        toolCall.started = true;
        yield {
          type: 'tool_call_start',
          callId: toolCall.callId,
          name: toolCall.name,
        };
      }
      if (toolCall.started) {
        yield { type: 'tool_call_end', callId: toolCall.callId };
      }
    }
    if (!started) {
      yield { type: 'message_start', responseId };
    }
    if (!ended) {
      ended = true;
      yield { type: 'message_end', finishReason };
    }
  }

  public async getCapabilities(config: ProviderConfig, model: string): Promise<ModelCapabilities> {
    return resolveModelCapabilities(config, model);
  }

  private async *completeChat(
    config: ProviderConfig,
    request: ChatRequest,
    context: ProviderContext,
  ): AsyncIterable<ChatStreamEvent> {
    const response = await fetchWithHeaderTimeout(
      endpoint(config, 'chat/completions'),
      {
        method: 'POST',
        headers: buildHeaders(context),
        body: JSON.stringify(requestBody(request, false)),
      },
      context.signal,
    );
    assertSuccessful(response);
    const parsed = chatCompletionSchema.safeParse(await readLimitedJson(response));
    if (!parsed.success) {
      throw new ProviderServiceError(
        'PROVIDER_UNAVAILABLE',
        '模型服务返回了不兼容的聊天响应。',
        false,
      );
    }

    yield {
      type: 'message_start',
      responseId: parsed.data.id ?? context.requestId,
    };
    const choice = parsed.data.choices[0];
    if (choice?.message.reasoning_content !== undefined) {
      yield { type: 'reasoning_delta', delta: choice.message.reasoning_content ?? '' };
    }
    if (choice?.message.content !== undefined) {
      yield { type: 'text_delta', delta: choice.message.content ?? '' };
    }
    for (const toolCall of choice?.message.tool_calls ?? []) {
      yield {
        type: 'tool_call_start',
        callId: toolCall.id,
        name: toolCall.function.name,
      };
      if (toolCall.function.arguments !== '') {
        yield {
          type: 'tool_call_delta',
          callId: toolCall.id,
          argumentsDelta: toolCall.function.arguments,
        };
      }
      yield { type: 'tool_call_end', callId: toolCall.id };
    }
    if (parsed.data.usage !== undefined) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: parsed.data.usage.prompt_tokens,
          outputTokens: parsed.data.usage.completion_tokens,
        },
      };
    }
    yield {
      type: 'message_end',
      finishReason: choice?.finish_reason ?? 'stop',
    };
  }
}
