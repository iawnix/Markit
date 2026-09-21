export interface FileRevision { hash: string; size: number; modifiedMs: number }
export interface Selection { anchor: number; head: number }
export interface DocumentSnapshot {
  id: string; path: string | null; title: string; source: string; savedSource: string;
  dirty: boolean; revision: FileRevision | null; bom: boolean; lineEnding: 'LF' | 'CRLF'; mode: 'source' | 'live'; selection: Selection; scrollTop: number;
}
export interface DirectoryEntry { name: string; path: string; directory: boolean }
export interface OutlineEntry { id: string; text: string; level: number; offset: number }
export interface ImageInput { name: string; bytes: number[] }
export type Locale = 'zh-CN' | 'en';
export type PluginPermission = 'document.read' | 'document.write' | 'filesystem.read' | 'filesystem.write' | 'network' | 'commands' | 'settings';
export interface PluginManifest {
  id: string; name: string; version: string; apiVersion: number; entry: string;
  permissions: PluginPermission[]; contributions: PluginContribution[];
}
export interface PluginContribution { type: 'command' | 'menu' | 'panel' | 'markdown' | 'exporter' | 'references'; id: string; title?: string }
