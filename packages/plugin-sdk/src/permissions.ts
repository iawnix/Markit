import type { PluginPermission } from '../../contracts/src/index';

export const highRiskPermissions: readonly PluginPermission[] = ['filesystem.read', 'filesystem.write', 'network', 'commands'];

export function requiresPrompt(permission: PluginPermission): boolean {
  return highRiskPermissions.includes(permission);
}

export function normalizePermissions(value: unknown): PluginPermission[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<PluginPermission>(['document.read', 'document.write', 'filesystem.read', 'filesystem.write', 'network', 'commands', 'settings']);
  return [...new Set(value.filter((item): item is PluginPermission => typeof item === 'string' && allowed.has(item as PluginPermission)))];
}
