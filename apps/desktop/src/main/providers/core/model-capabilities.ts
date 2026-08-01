import type {
  ModelCapabilities,
  ProviderConfig,
  ProviderKind,
} from '@open-code-desk/provider-core';

interface CapabilityHints {
  readonly reasoning?: boolean;
  readonly structuredOutput?: boolean;
  readonly vision?: boolean;
}

function hintsForModel(kind: ProviderKind, model: string): CapabilityHints {
  const normalized = model.toLowerCase();
  const visionModel =
    /(?:vision|[-:/]vl(?:[-:]|$)|llava|gpt-4o|gpt-5|gemini|claude-(?:3|4|5))/.test(normalized);
  const reasoningModel =
    /(?:reasoner|deepseek-r1|qwq|qwen3|glm-z1|kimi-k2|thinking|gpt-5|codex|^o[1-9](?:[-:]|$)|gemini-(?:2\.5|3)|claude-(?:3-7|4|5))/.test(
      normalized,
    );

  switch (kind) {
    case 'openai':
      return {
        reasoning: reasoningModel,
        structuredOutput: /(?:gpt-4o|gpt-5|o[1-9]|codex)/.test(normalized),
        vision: visionModel,
      };
    case 'anthropic':
      return {
        reasoning: reasoningModel,
        structuredOutput: true,
        vision: visionModel,
      };
    case 'gemini':
      return {
        reasoning: reasoningModel,
        structuredOutput: true,
        vision: true,
      };
    case 'deepseek':
      return { reasoning: reasoningModel, structuredOutput: true };
    case 'qwen':
      return {
        reasoning: reasoningModel,
        structuredOutput: true,
        vision: visionModel,
      };
    case 'glm':
      return {
        reasoning: reasoningModel,
        structuredOutput: true,
        vision: visionModel,
      };
    case 'moonshot':
      return {
        reasoning: reasoningModel,
        structuredOutput: true,
        vision: visionModel,
      };
    case 'ollama':
      return {
        reasoning: reasoningModel,
        vision: visionModel,
      };
    case 'openrouter':
      return {
        reasoning: reasoningModel,
        vision: visionModel,
      };
    case 'openai-compatible':
      return {};
  }
}

export function resolveModelCapabilities(config: ProviderConfig, model: string): ModelCapabilities {
  const hints = hintsForModel(config.kind, model);
  return {
    ...config.capabilities,
    reasoning: config.capabilities.reasoning || hints.reasoning === true,
    structuredOutput: config.capabilities.structuredOutput || hints.structuredOutput === true,
    vision: config.capabilities.vision || hints.vision === true,
  };
}
