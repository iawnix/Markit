import { unzipSync } from 'fflate';
import type { PluginManifest } from '../../contracts/src/index';
import { validateManifest } from './index';

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface MarkitPluginPackage {
  manifest: PluginManifest;
  entrySource: string;
  files: string[];
  integrityVerified: boolean;
  signaturePresent: boolean;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function safePackagePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => part === '' || part === '.' || part === '..');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', input.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Validates a local .markit-plugin archive before it is registered. */
export async function parsePluginPackage(bytes: Uint8Array): Promise<MarkitPluginPackage> {
  if (!bytes.length || bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error('Plugin package exceeds the 64 MiB limit.');
  let archive: Record<string, Uint8Array>;
  try { archive = unzipSync(bytes); } catch { throw new Error('The plugin package is not a valid ZIP archive.'); }
  const paths = Object.keys(archive);
  if (!paths.length || paths.some(path => !safePackagePath(path))) throw new Error('Plugin package contains an unsafe path.');
  if (paths.some(path => archive[path].byteLength > MAX_FILE_BYTES)) throw new Error('A plugin file exceeds the 16 MiB limit.');
  const manifestBytes = archive['manifest.json'];
  if (!manifestBytes) throw new Error('Plugin package is missing manifest.json.');
  let value: unknown;
  try { value = JSON.parse(decode(manifestBytes)); } catch { throw new Error('Plugin manifest is not valid JSON.'); }
  if (!validateManifest(value)) throw new Error('Plugin manifest is invalid.');
  const manifest = value as PluginManifest;
  if (manifest.apiVersion !== 1) throw new Error(`Unsupported plugin API version: ${manifest.apiVersion}`);
  if (!safePackagePath(manifest.entry) || !archive[manifest.entry]) throw new Error('Plugin entry file is missing.');
  const integrityBytes = archive['integrity.json'];
  let integrityVerified = false;
  if (integrityBytes) {
    let integrity: unknown;
    try { integrity = JSON.parse(decode(integrityBytes)); } catch { throw new Error('Plugin integrity.json is not valid JSON.'); }
    if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) throw new Error('Plugin integrity.json must be an object.');
    for (const [path, expected] of Object.entries(integrity)) {
      if (!safePackagePath(path) || !archive[path] || typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Plugin integrity manifest is invalid.');
      if ((await sha256(archive[path])).toLowerCase() !== expected.toLowerCase()) throw new Error(`Plugin integrity check failed for ${path}.`);
    }
    integrityVerified = true;
  }
  const signatureBytes = archive['signature.json'];
  if (signatureBytes) {
    try { JSON.parse(decode(signatureBytes)); } catch { throw new Error('Plugin signature.json is not valid JSON.'); }
  }
  return { manifest, entrySource: decode(archive[manifest.entry]), files: paths, integrityVerified, signaturePresent: Boolean(signatureBytes) };
}
