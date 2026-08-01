import type { ProviderRegistry } from '@open-code-desk/provider-core';

import { AnthropicProvider } from './anthropic/anthropic.provider';
import { DeepSeekProvider } from './deepseek/deepseek.provider';
import { GeminiProvider } from './gemini/gemini.provider';
import { GlmProvider } from './glm/glm.provider';
import { MoonshotProvider } from './moonshot/moonshot.provider';
import { OllamaProvider } from './ollama/ollama.provider';
import { OpenAICompatibleProvider } from './openai-compatible/openai-compatible.provider';
import { OpenAIProvider } from './openai/openai.provider';
import { OpenRouterProvider } from './openrouter/openrouter.provider';
import { QwenProvider } from './qwen/qwen.provider';

export function registerModelProviders(registry: ProviderRegistry): void {
  registry.register(new OpenAICompatibleProvider());
  registry.register(new OpenAIProvider());
  registry.register(new AnthropicProvider());
  registry.register(new GeminiProvider());
  registry.register(new OpenRouterProvider());
  registry.register(new DeepSeekProvider());
  registry.register(new QwenProvider());
  registry.register(new GlmProvider());
  registry.register(new MoonshotProvider());
  registry.register(new OllamaProvider());
}
