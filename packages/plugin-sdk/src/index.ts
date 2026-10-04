import type { DocumentSnapshot, PluginManifest, PluginPermission } from '../../contracts/src/index';

export interface MarkitPluginContext {
  manifest: PluginManifest;
  hasPermission(permission: PluginPermission): boolean;
  registerCommand(command: PluginCommand): () => void;
  registerPanel(panel: PluginPanel): () => void;
  readDocument(): Promise<DocumentSnapshot | null>;
  updateDocument(source: string): Promise<void>;
  fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
  updatePanel(panelId: string, content: PluginPanelContent): Promise<void>;
  readSetting(key: string): Promise<string | null>;
  writeSetting(key: string, value: string): Promise<void>;
}

export interface PluginFetchInit { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }
export interface PluginFetchResponse { status: number; headers: Record<string, string>; body: string }

export interface PluginCommand { id: string; title: string; shortcut?: string; visible?: boolean; run(...args: unknown[]): void | Promise<void> }
export interface PluginCommandDescriptor { id: string; title: string; shortcut?: string; visible?: boolean }
export interface PluginPanelItem { id: string; title: string; meta?: string; command?: { id: string; args?: unknown[] } }
export interface PluginPanelContent { status?: string; items?: PluginPanelItem[] }
export interface PluginPanel { id: string; title: string; attribution?: string; searchCommand?: string; initialContent?: PluginPanelContent; mount(container: HTMLElement): () => void }
export interface PluginPanelDescriptor { id: string; title: string; attribution?: string; searchCommand?: string; initialContent?: PluginPanelContent }
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

export { parsePluginPackage } from './package';
export type { MarkitPluginPackage } from './package';
export { loadPluginEntry, removePluginEntry, savePluginEntry } from './package-store';
