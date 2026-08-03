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
  buildGeminiHeaders,
  geminiGenerateEndpoint,
  geminiModelListSchema,
  geminiModelsEndpoint,
  geminiRequestBody,
  geminiResponseSchema,
} from './gemini-http';

const maximumStreamBytes = 10_000_000;

function incompatibleResponse(message: string): ProviderServiceError {
  return new ProviderServiceError('PROVIDER_UNAVAILABLE', message, false);
}

export class GeminiProvider implements ModelProvider {
  public readonly id = 'gemini';
  public readonly name = 'Google Gemini';
  public readonly kind = 'gemini' as const;

  public async validateConfig(
    config: ProviderConfig,
    context: ProviderContext,
  ): Promise<ValidationResult> {
    const models = await this.listModels(config, context);
    return {
      valid: true,
      message:
        models.length === 0
          ? '连接成功，但 Gemini 未返回可用模型。'
          : `连接成功，发现 ${models.length} 个 Gemini 模型。`,
    };
  }

  public async listModels(
    config: ProviderConfig,
    context: ProviderContext,
  ): Promise<ReadonlyArray<ModelInfo>> {
    const response = await fetchWithHeaderTimeout(
      geminiModelsEndpoint(config),
      { method: 'GET', headers: buildGeminiHeaders(context) },
      context.signal,
    );
    assertSuccessful(response);
    const parsed = geminiModelListSchema.safeParse(
      await readLimitedJson(response, { signal: context.signal }),
    );
    if (!parsed.success) {
      throw incompatibleResponse('Gemini 模型列表响应格式不兼容。请检查 Base URL。');
    }
    return parsed.data.models
      .filter(
        (model) =>
          model.supportedGenerationMethods === undefined ||
          model.supportedGenerationMethods.includes('generateContent'),
      )
      .map((model) => ({
        id: model.name.replace(/^models\//, ''),
        name: model.displayName ?? model.name.replace(/^models\//, ''),
        ownedBy: 'google',
        capabilities: resolveModelCapabilities(config, model.name),
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
      geminiGenerateEndpoint(config, request.model, true),
      {
        method: 'POST',
        headers: buildGeminiHeaders(context),
        body: JSON.stringify(geminiRequestBody(request)),
      },
      context.signal,
    );
    assertSuccessful(response);
    if (response.body === null) {
      throw incompatibleResponse('Gemini 没有返回流式响应正文。');
    }

    let receivedBytes = 0;
    let responseId = context.requestId;
    let started = false;
    let finishReason = 'STOP';

    for await (const data of parseServerSentEvents(response.body, context.signal)) {
      receivedBytes += Buffer.byteLength(data);
      if (receivedBytes > maximumStreamBytes) {
        throw incompatibleResponse('Gemini 流式响应超过 10 MB 安全限制。');
      }
      let untrustedChunk: unknown;
      try {
        untrustedChunk = JSON.parse(data) as unknown;
      } catch {
        throw incompatibleResponse('Gemini 返回了无法解析的流式数据。');
      }
      const parsed = geminiResponseSchema.safeParse(untrustedChunk);
      if (!parsed.success) {
        throw incompatibleResponse('Gemini 返回了格式不兼容的流式事件。');
      }
      responseId = parsed.data.responseId ?? responseId;
      if (!started) {
        started = true;
        yield { type: 'message_start', responseId };
      }
      yield* this.eventsForResponse(parsed.data, context.requestId);
      const candidateReason = parsed.data.candidates.find(
        (candidate) => candidate.finishReason !== undefined,
      )?.finishReason;
      if (candidateReason !== undefined) {
        finishReason = candidateReason;
      }
    }

    if (!started) {
      yield { type: 'message_start', responseId };
    }
    yield { type: 'message_end', finishReason };
  }

  public async getCapabilities(config: ProviderConfig, model: string): Promise<ModelCapabilities> {
    return resolveModelCapabilities(config, model);
  }

  private *eventsForResponse(
    response: typeof geminiResponseSchema._output,
    requestId: string,
  ): Iterable<ChatStreamEvent> {
    for (const [candidateOffset, candidate] of response.candidates.entries()) {
      const candidateIndex = candidate.index ?? candidateOffset;
      for (const [partIndex, part] of candidate.content.parts.entries()) {
        if (part.text !== undefined) {
          yield part.thought === true
            ? { type: 'reasoning_delta', delta: part.text }
            : { type: 'text_delta', delta: part.text };
        }
        if (part.functionCall !== undefined) {
          const callId =
            part.functionCall.id ?? `gemini-${requestId}-${candidateIndex}-${partIndex}`;
          yield {
            type: 'tool_call_start',
            callId,
            name: part.functionCall.name,
          };
          yield {
            type: 'tool_call_delta',
            callId,
            argumentsDelta: JSON.stringify(part.functionCall.args),
          };
          yield { type: 'tool_call_end', callId };
        }
      }
    }
    if (response.usageMetadata !== undefined) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: response.usageMetadata.promptTokenCount,
          outputTokens: response.usageMetadata.candidatesTokenCount,
        },
      };
    }
  }

  private async *completeChat(
    config: ProviderConfig,
    request: ChatRequest,
    context: ProviderContext,
  ): AsyncIterable<ChatStreamEvent> {
    const response = await fetchWithHeaderTimeout(
      geminiGenerateEndpoint(config, request.model, false),
      {
        method: 'POST',
        headers: buildGeminiHeaders(context),
        body: JSON.stringify(geminiRequestBody(request)),
      },
      context.signal,
    );
    assertSuccessful(response);
    const parsed = geminiResponseSchema.safeParse(
      await readLimitedJson(response, { signal: context.signal }),
    );
    if (!parsed.success) {
      throw incompatibleResponse('Gemini 消息响应格式不兼容。');
    }
    yield {
      type: 'message_start',
      responseId: parsed.data.responseId ?? context.requestId,
    };
    yield* this.eventsForResponse(parsed.data, context.requestId);
    yield {
      type: 'message_end',
      finishReason:
        parsed.data.candidates.find((candidate) => candidate.finishReason !== undefined)
          ?.finishReason ?? 'STOP',
    };
  }
}
