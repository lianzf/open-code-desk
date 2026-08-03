import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';
import {
  ProviderRegistry,
  type ChatStreamEvent,
  type ProviderConfig,
  type ProviderContext,
} from '@open-code-desk/provider-core';

import { registerModelProviders } from './register-model-providers';
import {
  formatLiveProviderFailure,
  liveProviderTargets,
  parseLiveProviderSelection,
  readLiveProviderSettings,
} from './provider-live-acceptance-support.acceptance';

const selectedKinds = parseLiveProviderSelection(process.env.OPEN_CODE_DESK_PROVIDER_ACCEPTANCE);
const registry = new ProviderRegistry();
registerModelProviders(registry);

for (const target of liveProviderTargets) {
  it.skipIf(!selectedKinds.has(target.kind))(
    `${target.kind} validates the live service and completes a bounded streaming response`,
    async () => {
      let secretValues: ReadonlyArray<string> = [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const settings = readLiveProviderSettings(target, process.env);
        secretValues = settings.secretValues;
        const config: ProviderConfig = {
          id: `${target.kind}-live-acceptance`,
          kind: target.kind,
          displayName: `${target.kind} live acceptance`,
          baseUrl: settings.baseUrl,
          defaultModel: settings.model,
          capabilities: {
            streaming: true,
            toolCalling: true,
            vision: false,
            reasoning: false,
            structuredOutput: false,
            contextWindow: 32_000,
            maxOutputTokens: 32,
          },
        };
        const context: ProviderContext = {
          requestId: randomUUID(),
          signal: controller.signal,
          ...(settings.apiKey === undefined ? {} : { apiKey: settings.apiKey }),
          customHeaders: settings.customHeaders,
        };
        const provider = registry.get(target.kind);

        const validation = await provider.validateConfig(config, context);
        expect(validation.valid).toBe(true);

        const eventTypes: ChatStreamEvent['type'][] = [];
        let receivedContent = false;
        for await (const event of provider.streamChat(
          config,
          {
            model: settings.model,
            messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
            temperature: 0,
            maxOutputTokens: 32,
          },
          context,
        )) {
          eventTypes.push(event.type);
          if (
            (event.type === 'text_delta' || event.type === 'reasoning_delta') &&
            event.delta.trim() !== ''
          ) {
            receivedContent = true;
          }
        }

        expect(eventTypes).toContain('message_start');
        expect(eventTypes).toContain('message_end');
        expect(receivedContent).toBe(true);
      } catch (error) {
        throw new Error(formatLiveProviderFailure(target.kind, error, secretValues));
      } finally {
        clearTimeout(timer);
      }
    },
    75_000,
  );
}
