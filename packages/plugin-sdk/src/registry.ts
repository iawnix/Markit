import type { PluginManifest } from '../../contracts/src/index';
import { normalizePermissions } from './permissions';
import { validateManifest } from './index';

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  error?: string;
  installedAt: number;
  integrityVerified: boolean;
  signaturePresent: boolean;
}

export interface PersistedPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  error?: string;
  installedAt?: number;
  integrityVerified?: boolean;
  signaturePresent?: boolean;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, InstalledPlugin>();

  constructor(initial: unknown[] = []) {
    this.restore(initial);
  }

  install(value: unknown, metadata: { integrityVerified?: boolean; signaturePresent?: boolean } = {}): InstalledPlugin {
    if (!validateManifest(value)) throw new Error('Invalid Markit plugin manifest.');
    const manifest: PluginManifest = { ...value, permissions: normalizePermissions(value.permissions), contributions: [...value.contributions] };
    if (manifest.apiVersion !== 1) throw new Error(`Unsupported plugin API version: ${manifest.apiVersion}`);
    if (this.plugins.has(manifest.id)) throw new Error(`Plugin is already installed: ${manifest.id}`);
    const installed = { manifest, enabled: false, installedAt: Date.now(), integrityVerified: metadata.integrityVerified === true, signaturePresent: metadata.signaturePresent === true };
    this.plugins.set(manifest.id, installed);
    return installed;
  }

  remove(id: string): boolean { return this.plugins.delete(id); }
  setEnabled(id: string, enabled: boolean): InstalledPlugin { const plugin = this.require(id); plugin.enabled = enabled; return plugin; }
  setError(id: string, error?: string): InstalledPlugin { const plugin = this.require(id); plugin.error = error; return plugin; }
  list(): InstalledPlugin[] { return [...this.plugins.values()].map(plugin => ({ ...plugin, manifest: { ...plugin.manifest, permissions: [...plugin.manifest.permissions], contributions: [...plugin.manifest.contributions] } })); }
  get(id: string): InstalledPlugin | undefined { return this.plugins.get(id); }

  toJSON(): PersistedPlugin[] { return this.list(); }

  restore(values: unknown[]): void {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const persisted = value as Partial<PersistedPlugin>;
      if (!validateManifest(persisted.manifest) || persisted.manifest.apiVersion !== 1 || this.plugins.has(persisted.manifest.id)) continue;
      this.plugins.set(persisted.manifest.id, {
        manifest: { ...persisted.manifest, permissions: normalizePermissions(persisted.manifest.permissions), contributions: [...persisted.manifest.contributions] },
        enabled: persisted.enabled === true,
        ...(typeof persisted.error === 'string' ? { error: persisted.error } : {}),
        installedAt: typeof persisted.installedAt === 'number' ? persisted.installedAt : Date.now(),
        integrityVerified: persisted.integrityVerified === true,
        signaturePresent: persisted.signaturePresent === true,
      });
    }
  }

  private require(id: string): InstalledPlugin { const plugin = this.plugins.get(id); if (!plugin) throw new Error(`Plugin is not installed: ${id}`); return plugin; }
}
