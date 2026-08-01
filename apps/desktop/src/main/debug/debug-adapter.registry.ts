import type { RuntimeDebugAdapterProvider } from './debug-adapter';

export class DebugAdapterRegistry {
  readonly #providers = new Map<string, RuntimeDebugAdapterProvider>();

  public register(provider: RuntimeDebugAdapterProvider): void {
    if (this.#providers.has(provider.type)) {
      throw new Error(`调试适配器 ${provider.type} 已注册。`);
    }
    this.#providers.set(provider.type, provider);
  }

  public get(type: string): RuntimeDebugAdapterProvider {
    const provider = this.#providers.get(type);
    if (provider === undefined) {
      throw new Error(`未注册调试适配器 ${type}。`);
    }
    return provider;
  }

  public list(): ReadonlyArray<RuntimeDebugAdapterProvider> {
    return [...this.#providers.values()];
  }
}
