import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import type {
  ConnectionTestResult,
  ModelInfo as PublicModelInfo,
  ProviderConfig as PublicProviderConfig,
  ProviderDescriptor as PublicProviderDescriptor,
  ProviderHeaderInput,
  SaveProviderRequest,
} from '@open-code-desk/ipc-contracts';
import {
  providerKinds,
  type ChatRequest,
  type ChatStreamEvent,
  type ChatToolDefinition,
  type ModelProvider,
  type ProviderConfig,
  type ProviderContext,
  type ProviderKind,
  type ProviderRegistry,
} from '@open-code-desk/provider-core';

import type { SecretStore } from '../security/secret-store';
import {
  isSensitiveHeaderName,
  validateCustomHeader,
  validateProviderBaseUrl,
} from './core/provider-network-policy';
import { normalizeProviderError, ProviderServiceError } from './core/provider-error';
import {
  ProviderConfigRepository,
  type SaveStoredProviderConfig,
  type StoredProviderConfig,
} from './provider-config.repository';

const secretPayloadSchema = z
  .object({
    apiKey: z.string().optional(),
    headers: z.record(z.string(), z.string()),
  })
  .strict();

type SecretPayload = z.infer<typeof secretPayloadSchema>;

const providerDisplayNames: Readonly<Record<ProviderKind, string>> = {
  'openai-compatible': 'OpenAI Compatible',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  qwen: '阿里云通义千问',
  glm: '智谱 GLM',
  moonshot: 'Moonshot / Kimi',
  ollama: 'Ollama',
};

interface PreparedHeaders {
  readonly publicHeaders: Readonly<Record<string, string>>;
  readonly sensitiveHeaders: Readonly<Record<string, string>>;
  readonly sensitiveHeaderNames: ReadonlyArray<string>;
}

export interface ProviderRuntime {
  readonly adapter: ModelProvider;
  readonly config: ProviderConfig;
  readonly context: ProviderContext;
}

export interface ProviderChatProfile {
  readonly model: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly toolCalling: boolean;
}

function toCoreConfig(stored: StoredProviderConfig): ProviderConfig {
  return {
    id: stored.id,
    kind: stored.kind,
    displayName: stored.displayName,
    baseUrl: stored.baseUrl,
    defaultModel: stored.defaultModel,
    capabilities: {
      streaming: stored.streaming,
      toolCalling: stored.toolCalling,
      vision: stored.vision,
      reasoning: stored.reasoningModel !== undefined,
      structuredOutput: false,
      contextWindow: stored.contextWindow,
    },
  };
}

function toPublicConfig(stored: StoredProviderConfig): PublicProviderConfig {
  const sensitiveNames = new Set(stored.sensitiveHeaderNames.map((name) => name.toLowerCase()));
  const customHeaders = [
    ...Object.entries(stored.customHeaders).map(([name, value]) => ({
      name,
      value,
      sensitive: false,
      configured: true,
    })),
    ...stored.sensitiveHeaderNames
      .filter((name) => !Object.keys(stored.customHeaders).some((key) => key === name))
      .map((name) => ({
        name,
        sensitive: sensitiveNames.has(name.toLowerCase()),
        configured: true,
      })),
  ];

  return {
    id: stored.id,
    kind: stored.kind,
    displayName: stored.displayName,
    baseUrl: stored.baseUrl,
    defaultModel: stored.defaultModel,
    ...(stored.fastModel === undefined ? {} : { fastModel: stored.fastModel }),
    ...(stored.reasoningModel === undefined ? {} : { reasoningModel: stored.reasoningModel }),
    contextWindow: stored.contextWindow,
    toolCalling: stored.toolCalling,
    vision: stored.vision,
    streaming: stored.streaming,
    customHeaders,
    hasApiKey: stored.hasApiKey,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function prepareHeaders(
  inputHeaders: ReadonlyArray<ProviderHeaderInput>,
  existingSecrets: Readonly<Record<string, string>>,
): PreparedHeaders {
  const publicHeaders: Record<string, string> = {};
  const sensitiveHeaders: Record<string, string> = {};
  const sensitiveHeaderNames: string[] = [];
  const seenNames = new Set<string>();

  for (const header of inputHeaders) {
    const lowerName = header.name.toLowerCase();
    if (seenNames.has(lowerName)) {
      throw new ProviderServiceError(
        'VALIDATION_ERROR',
        `自定义请求头 ${header.name} 重复。`,
        false,
      );
    }
    seenNames.add(lowerName);
    const sensitive = header.sensitive || isSensitiveHeaderName(header.name);
    const existingEntry = Object.entries(existingSecrets).find(
      ([name]) => name.toLowerCase() === lowerName,
    );
    const value = header.value ?? (sensitive ? existingEntry?.[1] : undefined);
    if (value === undefined) {
      throw new ProviderServiceError(
        'VALIDATION_ERROR',
        `请填写自定义请求头 ${header.name} 的值。`,
        false,
      );
    }
    validateCustomHeader(header.name, value);
    if (sensitive) {
      sensitiveHeaders[header.name] = value;
      sensitiveHeaderNames.push(header.name);
    } else {
      publicHeaders[header.name] = value;
    }
  }

  return { publicHeaders, sensitiveHeaders, sensitiveHeaderNames };
}

function hasSecretPayload(payload: SecretPayload): boolean {
  return payload.apiKey !== undefined || Object.keys(payload.headers).length > 0;
}

export class ProviderService {
  public constructor(
    private readonly repository: ProviderConfigRepository,
    private readonly secretStore: SecretStore,
    private readonly registry: ProviderRegistry,
  ) {}

  public listKinds(): ReadonlyArray<PublicProviderDescriptor> {
    const availableKinds = new Set(this.registry.list().map((provider) => provider.kind));
    return providerKinds.map((kind) => ({
      id: kind,
      kind,
      name: providerDisplayNames[kind],
      available: availableKinds.has(kind),
    }));
  }

  public list(): ReadonlyArray<PublicProviderConfig> {
    return this.repository.list().map(toPublicConfig);
  }

  public async save(input: SaveProviderRequest): Promise<PublicProviderConfig> {
    const providerId = input.id ?? randomUUID();
    const existing = this.repository.findById(providerId);
    const existingPayload = await this.readSecretPayload(existing);
    const apiKey =
      input.apiKey === undefined
        ? existingPayload.apiKey
        : input.apiKey.trim() === ''
          ? undefined
          : input.apiKey.trim();
    const headers = prepareHeaders(input.customHeaders, existingPayload.headers);
    const newPayload: SecretPayload = {
      ...(apiKey === undefined ? {} : { apiKey }),
      headers: headers.sensitiveHeaders,
    };
    const newSecretRef = hasSecretPayload(newPayload)
      ? `provider:${providerId}:${randomUUID()}`
      : undefined;

    if (newSecretRef !== undefined) {
      await this.secretStore.set(newSecretRef, JSON.stringify(newPayload));
    }

    const storedInput: SaveStoredProviderConfig = {
      id: providerId,
      kind: input.kind,
      displayName: input.displayName,
      baseUrl: validateProviderBaseUrl(input.baseUrl),
      defaultModel: input.defaultModel,
      ...(input.fastModel === undefined ? {} : { fastModel: input.fastModel }),
      ...(input.reasoningModel === undefined ? {} : { reasoningModel: input.reasoningModel }),
      contextWindow: input.contextWindow,
      toolCalling: input.toolCalling,
      vision: input.vision,
      streaming: input.streaming,
      customHeaders: headers.publicHeaders,
      sensitiveHeaderNames: headers.sensitiveHeaderNames,
      hasApiKey: apiKey !== undefined,
      ...(newSecretRef === undefined ? {} : { secretRef: newSecretRef }),
    };

    let stored: StoredProviderConfig;
    try {
      stored = this.repository.save(storedInput);
    } catch (error) {
      if (newSecretRef !== undefined) {
        await this.secretStore.delete(newSecretRef);
      }
      throw error;
    }

    if (existing?.secretRef !== undefined && existing.secretRef !== newSecretRef) {
      await this.secretStore.delete(existing.secretRef);
    }
    return toPublicConfig(stored);
  }

  public async delete(providerId: string): Promise<boolean> {
    const existing = this.repository.findById(providerId);
    if (existing === null) {
      throw new ProviderServiceError('VALIDATION_ERROR', '模型配置不存在，可能已经被删除。', false);
    }
    const deleted = this.repository.delete(providerId);
    try {
      if (existing.secretRef !== undefined) {
        await this.secretStore.delete(existing.secretRef);
      }
    } catch (error) {
      this.repository.save(existing);
      throw error;
    }
    return deleted;
  }

  public async testConnection(providerId: string): Promise<ConnectionTestResult> {
    const controller = new AbortController();
    try {
      const runtime = await this.getRuntime(providerId, randomUUID(), controller.signal);
      return await runtime.adapter.validateConfig(runtime.config, runtime.context);
    } catch (error) {
      const normalized = normalizeProviderError(error);
      return { valid: false, message: normalized.message };
    }
  }

  public async listModels(providerId: string): Promise<ReadonlyArray<PublicModelInfo>> {
    const controller = new AbortController();
    const runtime = await this.getRuntime(providerId, randomUUID(), controller.signal);
    return runtime.adapter.listModels(runtime.config, runtime.context);
  }

  public async createChatStream(
    providerId: string,
    model: string | undefined,
    messages: ChatRequest['messages'],
    requestId: string,
    signal: AbortSignal,
    tools?: ReadonlyArray<ChatToolDefinition>,
  ): Promise<AsyncIterable<ChatStreamEvent>> {
    const runtime = await this.getRuntime(providerId, requestId, signal);
    return runtime.adapter.streamChat(
      runtime.config,
      {
        model: model ?? runtime.config.defaultModel,
        messages,
        ...(tools === undefined ? {} : { tools }),
      },
      runtime.context,
    );
  }

  public async getChatProfile(
    providerId: string,
    model: string | undefined,
    requestId: string,
    signal: AbortSignal,
  ): Promise<ProviderChatProfile> {
    const runtime = await this.getRuntime(providerId, requestId, signal);
    const resolvedModel = model ?? runtime.config.defaultModel;
    const capabilities = await runtime.adapter.getCapabilities(runtime.config, resolvedModel);
    return {
      model: resolvedModel,
      contextWindow: capabilities.contextWindow ?? 32_000,
      maxOutputTokens: capabilities.maxOutputTokens ?? 4_096,
      toolCalling: capabilities.toolCalling,
    };
  }

  private async getRuntime(
    providerId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<ProviderRuntime> {
    const stored = this.repository.findById(providerId);
    if (stored === null) {
      throw new ProviderServiceError(
        'VALIDATION_ERROR',
        '模型配置不存在。请重新选择模型配置。',
        false,
      );
    }
    const payload = await this.readSecretPayload(stored);
    return {
      adapter: this.registry.get(stored.kind),
      config: toCoreConfig(stored),
      context: {
        requestId,
        signal,
        ...(payload.apiKey === undefined ? {} : { apiKey: payload.apiKey }),
        customHeaders: {
          ...stored.customHeaders,
          ...payload.headers,
        },
      },
    };
  }

  private async readSecretPayload(stored: StoredProviderConfig | null): Promise<SecretPayload> {
    if (stored?.secretRef === undefined) {
      return { headers: {} };
    }
    const untrustedPayload = await this.secretStore.get(stored.secretRef);
    if (untrustedPayload === null) {
      throw new ProviderServiceError(
        'PROVIDER_AUTH_FAILED',
        '模型凭据已丢失或无法读取。请重新填写 API Key 后保存。',
        false,
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(untrustedPayload) as unknown;
    } catch {
      throw new ProviderServiceError(
        'PROVIDER_AUTH_FAILED',
        '模型凭据已损坏。请重新填写 API Key 后保存。',
        false,
      );
    }
    const parsed = secretPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new ProviderServiceError(
        'PROVIDER_AUTH_FAILED',
        '模型凭据格式无效。请重新填写 API Key 后保存。',
        false,
      );
    }
    return parsed.data;
  }
}
