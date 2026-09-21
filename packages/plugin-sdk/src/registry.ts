import type { PluginManifest } from '../../contracts/src/index';
import { normalizePermissions } from './permissions';
import { validateManifest } from './index';

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  error?: string;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, InstalledPlugin>();

  install(value: unknown): InstalledPlugin {
    if (!validateManifest(value)) throw new Error('Invalid Markit plugin manifest.');
    const manifest: PluginManifest = { ...value, permissions: normalizePermissions(value.permissions), contributions: [...value.contributions] };
    if (manifest.apiVersion !== 1) throw new Error(`Unsupported plugin API version: ${manifest.apiVersion}`);
    if (this.plugins.has(manifest.id)) throw new Error(`Plugin is already installed: ${manifest.id}`);
    const installed = { manifest, enabled: false };
    this.plugins.set(manifest.id, installed);
    return installed;
  }

  remove(id: string): boolean { return this.plugins.delete(id); }
  setEnabled(id: string, enabled: boolean): InstalledPlugin { const plugin = this.require(id); plugin.enabled = enabled; return plugin; }
  list(): InstalledPlugin[] { return [...this.plugins.values()].map(plugin => ({ ...plugin, manifest: { ...plugin.manifest, permissions: [...plugin.manifest.permissions], contributions: [...plugin.manifest.contributions] } })); }
  get(id: string): InstalledPlugin | undefined { return this.plugins.get(id); }

  private require(id: string): InstalledPlugin { const plugin = this.plugins.get(id); if (!plugin) throw new Error(`Plugin is not installed: ${id}`); return plugin; }
}
