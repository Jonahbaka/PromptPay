import type { IProviderPlugin, ProviderCapability, ProviderHealthCheck } from './types.js';

export class ProviderRegistry {
  private plugins: Map<string, IProviderPlugin> = new Map();

  register(plugin: IProviderPlugin): void {
    if (this.plugins.has(plugin.slug)) {
      throw new Error(`Provider "${plugin.slug}" is already registered`);
    }
    this.plugins.set(plugin.slug, plugin);
  }

  get(slug: string): IProviderPlugin | undefined {
    return this.plugins.get(slug);
  }

  getOrThrow(slug: string): IProviderPlugin {
    const plugin = this.plugins.get(slug);
    if (!plugin) throw new Error(`Provider "${slug}" not found in registry`);
    return plugin;
  }

  listAll(): IProviderPlugin[] {
    return Array.from(this.plugins.values());
  }

  findByCapability(capability: ProviderCapability): IProviderPlugin[] {
    return this.listAll().filter(p => p.getCapabilities().includes(capability));
  }

  findByType(type: string): IProviderPlugin[] {
    return this.listAll().filter(p => p.providerType === type);
  }

  async healthCheckAll(): Promise<Map<string, ProviderHealthCheck>> {
    const results = new Map<string, ProviderHealthCheck>();
    const checks = this.listAll().map(async (p) => {
      try {
        const health = await p.checkHealth();
        results.set(p.slug, health);
      } catch (err) {
        results.set(p.slug, { status: 'down', latencyMs: 0, message: String(err) });
      }
    });
    await Promise.all(checks);
    return results;
  }

  get size(): number {
    return this.plugins.size;
  }
}
