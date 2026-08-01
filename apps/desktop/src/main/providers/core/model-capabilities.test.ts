import { describe, expect, it } from 'vitest';
import type { ProviderConfig, ProviderKind } from '@open-code-desk/provider-core';

import { resolveModelCapabilities } from './model-capabilities';

function config(kind: ProviderKind): ProviderConfig {
  return {
    id: 'd965a90b-a523-4b5d-884f-9c8705c6dc7e',
    kind,
    displayName: kind,
    baseUrl: 'https://api.example.com',
    defaultModel: 'fixture',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      reasoning: false,
      structuredOutput: false,
      contextWindow: 128_000,
    },
  };
}

describe('resolveModelCapabilities', () => {
  it('recognizes reasoning and vision families without changing user safety toggles', () => {
    expect(resolveModelCapabilities(config('openai'), 'gpt-5.2-codex')).toMatchObject({
      reasoning: true,
      vision: true,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
    });
    expect(resolveModelCapabilities(config('qwen'), 'qwen3-vl')).toMatchObject({
      reasoning: true,
      vision: true,
    });
    expect(resolveModelCapabilities(config('deepseek'), 'deepseek-reasoner')).toMatchObject({
      reasoning: true,
    });
  });

  it('leaves arbitrary OpenAI-compatible capability declarations unchanged', () => {
    expect(resolveModelCapabilities(config('openai-compatible'), 'gpt-5-unknown')).toEqual(
      config('openai-compatible').capabilities,
    );
  });
});
