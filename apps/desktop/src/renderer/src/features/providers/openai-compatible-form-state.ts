import type {
  ProviderConfig,
  ProviderKind,
  SaveProviderRequest,
} from '@open-code-desk/ipc-contracts';

export interface OpenAICompatibleFormProps {
  readonly configuration: ProviderConfig | null;
  readonly loading: boolean;
  readonly providerKind: ProviderKind;
  onSave(input: SaveProviderRequest): Promise<ProviderConfig>;
}

export interface HeaderDraft {
  readonly id: string;
  name: string;
  value: string;
  sensitive: boolean;
  configured: boolean;
}

export interface FormState {
  displayName: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  fastModel: string;
  reasoningModel: string;
  contextWindow: string;
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
  headers: HeaderDraft[];
}

const providerPresets: Readonly<
  Record<ProviderKind, Pick<FormState, 'displayName' | 'baseUrl' | 'contextWindow'>>
> = {
  'openai-compatible': {
    displayName: 'OpenAI Compatible',
    baseUrl: 'https://api.example.com/v1',
    contextWindow: '128000',
  },
  openai: {
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    contextWindow: '128000',
  },
  anthropic: {
    displayName: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    contextWindow: '200000',
  },
  gemini: {
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    contextWindow: '1000000',
  },
  openrouter: {
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    contextWindow: '128000',
  },
  deepseek: {
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    contextWindow: '128000',
  },
  qwen: {
    displayName: 'Alibaba Cloud Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextWindow: '128000',
  },
  glm: {
    displayName: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    contextWindow: '128000',
  },
  moonshot: {
    displayName: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    contextWindow: '128000',
  },
  ollama: {
    displayName: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    contextWindow: '32768',
  },
};

function emptyForm(providerKind: ProviderKind): FormState {
  return {
    ...providerPresets[providerKind],
    apiKey: '',
    defaultModel: '',
    fastModel: '',
    reasoningModel: '',
    toolCalling: true,
    vision: false,
    streaming: true,
    headers: [],
  };
}

export function fromConfiguration(
  configuration: ProviderConfig | null,
  providerKind: ProviderKind,
): FormState {
  if (configuration === null) return emptyForm(providerKind);
  return {
    displayName: configuration.displayName,
    baseUrl: configuration.baseUrl,
    apiKey: '',
    defaultModel: configuration.defaultModel,
    fastModel: configuration.fastModel ?? '',
    reasoningModel: configuration.reasoningModel ?? '',
    contextWindow: String(configuration.contextWindow),
    toolCalling: configuration.toolCalling,
    vision: configuration.vision,
    streaming: configuration.streaming,
    headers: configuration.customHeaders.map((header) => ({
      id: crypto.randomUUID(),
      name: header.name,
      value: header.value ?? '',
      sensitive: header.sensitive,
      configured: header.configured,
    })),
  };
}

export const inputClassName =
  'h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-500';

export const capabilityToggles = [
  { key: 'toolCalling', labelKey: 'toolCalling' },
  { key: 'vision', labelKey: 'imageInput' },
  { key: 'streaming', labelKey: 'streamingResponse' },
] as const;
