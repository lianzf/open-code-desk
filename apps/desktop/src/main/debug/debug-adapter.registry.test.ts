import { describe, expect, it } from 'vitest';

import type { RuntimeDebugAdapterProvider } from './debug-adapter';
import { DebugAdapterRegistry } from './debug-adapter.registry';

const provider = {
  type: 'pwa-node',
  displayName: 'Node.js',
  async isAvailable() {
    return true;
  },
  async validateConfiguration() {
    return { valid: true, errors: [], warnings: [] };
  },
  async createSession() {
    throw new Error('not used');
  },
} satisfies RuntimeDebugAdapterProvider;

describe('DebugAdapterRegistry', () => {
  it('registers adapters without language conditionals in the caller', () => {
    const registry = new DebugAdapterRegistry();
    registry.register(provider);
    expect(registry.get('pwa-node')).toBe(provider);
    expect(() => registry.register(provider)).toThrow('已注册');
    expect(() => registry.get('python')).toThrow('未注册');
  });
});
