import { describe, expect, it } from 'vitest';
import { providerKinds, ProviderRegistry } from '@open-code-desk/provider-core';

import { registerModelProviders } from './register-model-providers';

describe('registerModelProviders', () => {
  it('registers every supported provider kind exactly once', () => {
    const registry = new ProviderRegistry();

    registerModelProviders(registry);

    expect(registry.list().map((provider) => provider.kind)).toEqual(providerKinds);
    for (const kind of providerKinds) {
      expect(registry.get(kind).kind).toBe(kind);
    }
  });
});
