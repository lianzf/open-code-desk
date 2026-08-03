import type {
  ChatRequest,
  ChatStreamEvent,
  ModelCapabilities,
  ModelInfo,
  ModelProvider,
  ProviderConfig,
  ProviderContext,
  ValidationResult,
} from '@open-code-desk/provider-core';

import { ProviderServiceError } from '../core/provider-error';
import { resolveModelCapabilities } from '../core/model-capabilities';
import {
  assertSuccessful,
  fetchWithHeaderTimeout,
  readLimitedJson,
} from '../openai-compatible/openai-compatible-http';
import { parseServerSentEvents } from '../openai-compatible/sse-parser';
import {
  anthropicContentBlockDeltaSchema,
  anthropicContentBlockStartSchema,
  anthropicContentBlockStopSchema,
  anthropicEndpoint,
  anthropicErrorEventSchema,
  anthropicMessageDeltaSchema,
  anthropicMessageSchema,
  anthropicMessageStartSchema,
  anthropicModelListSchema,
  anthropicRequestBody,
  anthropicStreamEnvelopeSchema,
  buildAnthropicHeaders,
} from './anthropic-http';

const maximumStreamBytes = 10_000_000;

function incompatibleResponse(message: string): ProviderServiceError {
  return new ProviderServiceError('PROVIDER_UNAVAILABLE', message, false);
}

export class AnthropicProvider implements ModelProvider {
  public readonly id = 'anthropic';
  public readonly name = 'Anthropic Claude';
  public readonly kind = 'anthropic' as const;

  public async validateConfig(
    config: ProviderConfig,
    context: ProviderContext,
  ): Promise<ValidationResult> {
    const models = await this.listModels(config, context);
    return {
      valid: true,
      message:
        models.length === 0
          ? '连接成功，但 Anthropic 未返回可用模型。'
          : `连接成功，发现 ${models.length} 个 Anthropic 模型。`,
    };
  }

  public async listModels(
    config: ProviderConfig,
    context: ProviderContext,
  ): Promise<ReadonlyArray<ModelInfo>> {
    const response = await fetchWithHeaderTimeout(
      anthropicEndpoint(config, 'models'),
      { method: 'GET', headers: buildAnthropicHeaders(context) },
      context.signal,
    );
    assertSuccessful(response);
    const parsed = anthropicModelListSchema.safeParse(
      await readLimitedJson(response, { signal: context.signal }),
    );
    if (!parsed.success) {
      throw incompatibleResponse('Anthropic 模型列表响应格式不兼容。请检查 Base URL。');
    }
    return parsed.data.data.map((model) => ({
      id: model.id,
      name: model.display_name ?? model.id,
      ownedBy: 'anthropic',
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
      anthropicEndpoint(config, 'messages'),
      {
        method: 'POST',
        headers: buildAnthropicHeaders(context),
        body: JSON.stringify(anthropicRequestBody(request, true)),
      },
      context.signal,
    );
    assertSuccessful(response);
    if (response.body === null) {
      throw incompatibleResponse('Anthropic 没有返回流式响应正文。');
    }

    const openToolCalls = new Map<number, string>();
    let inputTokens = 0;
    let finishReason = 'end_turn';
    let receivedBytes = 0;
    let ended = false;

    for await (const data of parseServerSentEvents(response.body, context.signal)) {
      receivedBytes += Buffer.byteLength(data);
      if (receivedBytes > maximumStreamBytes) {
        throw incompatibleResponse('Anthropic 流式响应超过 10 MB 安全限制。');
      }
      let untrustedEvent: unknown;
      try {
        untrustedEvent = JSON.parse(data) as unknown;
      } catch {
        throw incompatibleResponse('Anthropic 返回了无法解析的流式事件。');
      }
      const envelope = anthropicStreamEnvelopeSchema.safeParse(untrustedEvent);
      if (!envelope.success) {
        throw incompatibleResponse('Anthropic 返回了格式不兼容的流式事件。');
      }

      if (envelope.data.type === 'message_start') {
        const event = anthropicMessageStartSchema.safeParse(untrustedEvent);
        if (!event.success) {
          throw incompatibleResponse('Anthropic message_start 事件格式不兼容。');
        }
        inputTokens = event.data.message.usage.input_tokens;
        yield { type: 'message_start', responseId: event.data.message.id };
      } else if (envelope.data.type === 'content_block_start') {
        const event = anthropicContentBlockStartSchema.safeParse(untrustedEvent);
        if (!event.success) {
          throw incompatibleResponse('Anthropic content_block_start 事件格式不兼容。');
        }
        const block = event.data.content_block;
        if (block.type === 'tool_use') {
          openToolCalls.set(event.data.index, block.id);
          yield {
            type: 'tool_call_start',
            callId: block.id,
            name: block.name,
          };
        }
      } else if (envelope.data.type === 'content_block_delta') {
        const event = anthropicContentBlockDeltaSchema.safeParse(untrustedEvent);
        if (!event.success) {
          throw incompatibleResponse('Anthropic content_block_delta 事件格式不兼容。');
        }
        const delta = event.data.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', delta: delta.text };
        } else if (delta.type === 'thinking_delta') {
          yield { type: 'reasoning_delta', delta: delta.thinking };
        } else if (delta.type === 'input_json_delta') {
          const callId = openToolCalls.get(event.data.index);
          if (callId !== undefined) {
            yield {
              type: 'tool_call_delta',
              callId,
              argumentsDelta: delta.partial_json,
            };
          }
        }
      } else if (envelope.data.type === 'content_block_stop') {
        const event = anthropicContentBlockStopSchema.safeParse(untrustedEvent);
        if (!event.success) {
          throw incompatibleResponse('Anthropic content_block_stop 事件格式不兼容。');
        }
        const callId = openToolCalls.get(event.data.index);
        if (callId !== undefined) {
          yield { type: 'tool_call_end', callId };
          openToolCalls.delete(event.data.index);
        }
      } else if (envelope.data.type === 'message_delta') {
        const event = anthropicMessageDeltaSchema.safeParse(untrustedEvent);
        if (!event.success) {
          throw incompatibleResponse('Anthropic message_delta 事件格式不兼容。');
        }
        finishReason = event.data.delta.stop_reason ?? finishReason;
        yield {
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens: event.data.usage.output_tokens,
          },
        };
      } else if (envelope.data.type === 'message_stop') {
        ended = true;
        yield { type: 'message_end', finishReason };
      } else if (envelope.data.type === 'error') {
        const event = anthropicErrorEventSchema.safeParse(untrustedEvent);
        throw new ProviderServiceError(
          'PROVIDER_UNAVAILABLE',
          event.success
            ? `Anthropic 流式请求失败（${event.data.error.type ?? 'unknown'}）。请稍后重试。`
            : 'Anthropic 流式请求失败。请稍后重试。',
          true,
        );
      }
    }

    for (const callId of openToolCalls.values()) {
      yield { type: 'tool_call_end', callId };
    }
    if (!ended) {
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
      anthropicEndpoint(config, 'messages'),
      {
        method: 'POST',
        headers: buildAnthropicHeaders(context),
        body: JSON.stringify(anthropicRequestBody(request, false)),
      },
      context.signal,
    );
    assertSuccessful(response);
    const parsed = anthropicMessageSchema.safeParse(
      await readLimitedJson(response, { signal: context.signal }),
    );
    if (!parsed.success) {
      throw incompatibleResponse('Anthropic 消息响应格式不兼容。');
    }
    yield { type: 'message_start', responseId: parsed.data.id };
    for (const block of parsed.data.content) {
      if (block.type === 'text') {
        yield { type: 'text_delta', delta: block.text };
      } else if (block.type === 'thinking') {
        yield { type: 'reasoning_delta', delta: block.thinking };
      } else {
        yield { type: 'tool_call_start', callId: block.id, name: block.name };
        yield {
          type: 'tool_call_delta',
          callId: block.id,
          argumentsDelta: JSON.stringify(block.input),
        };
        yield { type: 'tool_call_end', callId: block.id };
      }
    }
    yield {
      type: 'usage',
      usage: {
        inputTokens: parsed.data.usage.input_tokens,
        outputTokens: parsed.data.usage.output_tokens,
      },
    };
    yield {
      type: 'message_end',
      finishReason: parsed.data.stop_reason ?? 'end_turn',
    };
  }
}
