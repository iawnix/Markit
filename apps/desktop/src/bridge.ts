import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { DirectoryEntry, DocumentSnapshot, FileRevision, ImageInput, OutlineEntry, RecoveryDocument } from './contracts';

export const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) throw new Error('Unsupported link protocol.');
  if (isTauriRuntime) await openUrl(url.href);
  else window.open(url.href, '_blank', 'noopener,noreferrer');
}

function fallback<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

export async function readDocument(path: string): Promise<DocumentSnapshot> {
  if (!isTauriRuntime) {
    return fallback({
      id: crypto.randomUUID(), path, title: path.split(/[\\/]/).at(-1) || 'Untitled.md',
      source: '# Markit\n\nOpen this document in the desktop build to edit it.',
      savedSource: '# Markit\n\nOpen this document in the desktop build to edit it.', dirty: false,
      revision: null, bom: false, lineEnding: 'LF', mode: 'live', selection: { anchor: 0, head: 0 }, scrollTop: 0,
    });
  }
  return invoke<DocumentSnapshot>('read_document', { path });
}

export async function saveDocument(path: string, source: string, expected: FileRevision | null, bom: boolean, lineEnding: 'LF' | 'CRLF'): Promise<FileRevision> {
  if (!isTauriRuntime) return fallback({ hash: '', size: new TextEncoder().encode(source).byteLength, modifiedMs: Date.now() });
  return invoke<FileRevision>('save_document', { path, source, expected, bom, lineEnding });
}

export async function fileRevision(path: string): Promise<FileRevision> {
  if (!isTauriRuntime) return fallback({ hash: '', size: 0, modifiedMs: 0 });
  return invoke<FileRevision>('get_file_revision', { path });
}

export async function readRecovery(): Promise<RecoveryDocument[]> {
  if (!isTauriRuntime) return fallback([]);
  return invoke<RecoveryDocument[]>('read_recovery');
}

export async function writeRecovery(documents: DocumentSnapshot[]): Promise<void> {
  if (!isTauriRuntime) return;
  const records: RecoveryDocument[] = documents.map(({ externalChange: _externalChange, ...document }) => document);
  await invoke('write_recovery', { documents: records });
}

export async function clearRecovery(): Promise<void> {
  if (!isTauriRuntime) return;
  await invoke('clear_recovery');
}

export async function exportHtml(path: string, html: string): Promise<void> {
  if (!isTauriRuntime) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = path.split(/[\\/]/).at(-1) || 'Markit-export.html';
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  await invoke('export_html', { path, html });
}

export async function exportPng(path: string, bytes: Uint8Array): Promise<void> {
  if (!isTauriRuntime) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = path.split(/[\\/]/).at(-1) || 'Markit-export.png';
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  await invoke('export_png', { path, bytes: [...bytes] });
}

export async function registerAsset(documentPath: string, relativePath: string): Promise<string> {
  if (!isTauriRuntime) return relativePath;
  return invoke<string>('register_asset', { documentPath, relativePath });
}

export async function listDirectory(path: string): Promise<DirectoryEntry[]> {
  if (!isTauriRuntime) return fallback([]);
  return invoke<DirectoryEntry[]>('list_directory', { path });
}

export async function outline(source: string): Promise<OutlineEntry[]> {
  if (!isTauriRuntime) return fallback(parseOutline(source));
  return invoke<OutlineEntry[]>('extract_outline', { source });
}

export async function importImages(documentPath: string, inputs: ImageInput[], folder = 'assets'): Promise<string[]> {
  if (!isTauriRuntime) return fallback(inputs.map(input => `${folder}/${input.name}`));
  return invoke<string[]>('import_images', { documentPath, folder, inputs });
}

export async function readPluginPackage(path: string): Promise<number[]> {
  if (!isTauriRuntime) throw new Error('Plugin package reading is only available in the desktop build.');
  return invoke<number[]>('read_plugin_package', { path });
}

export function parseOutline(source: string): OutlineEntry[] {
  const result: OutlineEntry[] = [];
  for (const match of source.matchAll(/^(#{1,6})[ \t]+(.+?)\s*#*\s*$/gm)) {
    const text = match[2].replace(/[*_`~]/g, '').trim();
    result.push({ id: `heading-${result.length}`, text, level: match[1].length, offset: match.index ?? 0 });
  }
  return result;
}
