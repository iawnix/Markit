import type { DocumentSnapshot, PluginManifest, PluginPermission } from '../../contracts/src/index';

export interface MarkitPluginContext {
  manifest: PluginManifest;
  hasPermission(permission: PluginPermission): boolean;
  registerCommand(command: PluginCommand): () => void;
  registerPanel(panel: PluginPanel): () => void;
  readDocument(): Promise<DocumentSnapshot | null>;
  updateDocument(source: string): Promise<void>;
}

export interface PluginCommand { id: string; title: string; shortcut?: string; run(): void | Promise<void> }
export interface PluginPanel { id: string; title: string; mount(container: HTMLElement): () => void }
export interface MarkitPlugin { activate(context: MarkitPluginContext): void | Promise<void>; deactivate?(): void | Promise<void> }

export function validateManifest(value: unknown): value is PluginManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<PluginManifest>;
  return typeof manifest.id === 'string' && /^[a-z][a-z0-9.-]{2,100}$/.test(manifest.id)
    && typeof manifest.name === 'string' && typeof manifest.version === 'string'
    && Number.isInteger(manifest.apiVersion) && typeof manifest.entry === 'string'
    && Array.isArray(manifest.permissions) && manifest.permissions.every(permission => ['document.read', 'document.write', 'filesystem.read', 'filesystem.write', 'network', 'commands', 'settings'].includes(String(permission)))
    && Array.isArray(manifest.contributions);
}
