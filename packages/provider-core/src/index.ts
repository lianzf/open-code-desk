export const providerKinds = [
  'openai-compatible',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'deepseek',
  'qwen',
  'glm',
  'moonshot',
  'ollama',
] as const;

export type ProviderKind = (typeof providerKinds)[number];

export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly reasoning: boolean;
  readonly structuredOutput: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;
}

export interface ProviderConfig {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly capabilities: ModelCapabilities;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly ownedBy?: string;
  readonly capabilities?: ModelCapabilities;
}

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ChatTextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ChatImageContentPart {
  readonly type: 'image';
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  readonly data: string;
}

export type ChatContentPart = ChatTextContentPart | ChatImageContentPart;
export type ChatMessageContent = string | ReadonlyArray<ChatContentPart>;

export interface ChatMessage {
  readonly role: ChatMessageRole;
  readonly content: ChatMessageContent;
  readonly toolCallId?: string;
  readonly toolCalls?: ReadonlyArray<ChatToolCall>;
}

export interface ChatToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly tools?: ReadonlyArray<ChatToolDefinition>;
}

export interface ProviderContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly apiKey?: string;
  readonly customHeaders: Readonly<Record<string, string>>;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly message: string;
}

export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type ChatStreamEvent =
  | { readonly type: 'message_start'; readonly responseId: string }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'reasoning_delta'; readonly delta: string }
  | {
      readonly type: 'tool_call_start';
      readonly callId: string;
      readonly name: string;
    }
  | {
      readonly type: 'tool_call_delta';
      readonly callId: string;
      readonly argumentsDelta: string;
    }
  | { readonly type: 'tool_call_end'; readonly callId: string }
  | { readonly type: 'usage'; readonly usage: ProviderUsage }
  | { readonly type: 'message_end'; readonly finishReason: string };

export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;

  validateConfig(config: ProviderConfig, context: ProviderContext): Promise<ValidationResult>;

  listModels(config: ProviderConfig, context: ProviderContext): Promise<ReadonlyArray<ModelInfo>>;

  streamChat(
    config: ProviderConfig,
    request: ChatRequest,
    context: ProviderContext,
  ): AsyncIterable<ChatStreamEvent>;

  getCapabilities(config: ProviderConfig, model: string): Promise<ModelCapabilities>;
}

export class ProviderRegistryError extends Error {
  constructor(
    readonly code: 'PROVIDER_ALREADY_REGISTERED' | 'PROVIDER_NOT_REGISTERED',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderRegistryError';
  }
}

export class ProviderRegistry {
  readonly #providers = new Map<ProviderKind, ModelProvider>();

  register(provider: ModelProvider): void {
    if (this.#providers.has(provider.kind)) {
      throw new ProviderRegistryError(
        'PROVIDER_ALREADY_REGISTERED',
        `Provider kind "${provider.kind}" is already registered.`,
      );
    }
    this.#providers.set(provider.kind, provider);
  }

  get(kind: ProviderKind): ModelProvider {
    const provider = this.#providers.get(kind);
    if (provider === undefined) {
      throw new ProviderRegistryError(
        'PROVIDER_NOT_REGISTERED',
        `Provider kind "${kind}" is not registered.`,
      );
    }
    return provider;
  }

  list(): ReadonlyArray<ModelProvider> {
    return [...this.#providers.values()];
  }
}
