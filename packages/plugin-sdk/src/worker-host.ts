import type { MarkitPluginContext, MarkitPlugin } from './index';
import type { PluginManifest, PluginPermission } from '../../contracts/src/index';
import { requiresPrompt } from './permissions';

interface RequestMessage { type: 'request'; id: string; method: string; args: unknown[] }
interface ResponseMessage { type: 'response'; id: string; ok: boolean; value?: unknown; error?: string }

export interface PluginHostOptions {
  manifest: PluginManifest;
  confirmPermission(permission: PluginPermission): Promise<boolean>;
  handleRequest(method: string, args: unknown[]): Promise<unknown>;
}

/** Runs third-party plugin code without exposing the application DOM or Tauri invoke directly. */
export class PluginWorkerHost {
  private readonly worker: Worker;
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(private readonly options: PluginHostOptions) {
    this.worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', event => { void this.handleMessage(event.data as RequestMessage | ResponseMessage); });
    this.worker.addEventListener('error', event => { for (const request of this.pending.values()) request.reject(new Error(event.message || 'Plugin worker failed.')); this.pending.clear(); });
  }

  async activate(): Promise<void> {
    await this.request('activate', [this.options.manifest]);
  }

  async deactivate(): Promise<void> {
    await this.request('deactivate', []);
    this.worker.terminate();
  }

  private async handleMessage(message: RequestMessage | ResponseMessage) {
    if (message.type === 'response') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.ok ? pending.resolve(message.value) : pending.reject(new Error(message.error || 'Plugin request failed.'));
      return;
    }
    const permission = this.permissionFor(message.method);
    if (permission && !this.options.manifest.permissions.includes(permission)) {
      this.worker.postMessage({ type: 'response', id: message.id, ok: false, error: `Permission not declared: ${permission}` } satisfies ResponseMessage);
      return;
    }
    if (permission && (requiresPrompt(permission) && !(await this.options.confirmPermission(permission)))) {
      this.worker.postMessage({ type: 'response', id: message.id, ok: false, error: `Permission denied: ${permission}` } satisfies ResponseMessage);
      return;
    }
    try {
      const value = await this.options.handleRequest(message.method, message.args);
      this.worker.postMessage({ type: 'response', id: message.id, ok: true, value } satisfies ResponseMessage);
    } catch (error) {
      this.worker.postMessage({ type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ResponseMessage);
    }
  }

  private permissionFor(method: string): PluginPermission | undefined {
    if (method.startsWith('document.')) return method === 'document.update' ? 'document.write' : 'document.read';
    if (method.startsWith('filesystem.')) return method === 'filesystem.write' ? 'filesystem.write' : 'filesystem.read';
    if (method.startsWith('network.')) return 'network';
    if (method.startsWith('command.')) return 'commands';
    if (method.startsWith('settings.')) return 'settings';
    return undefined;
  }

  private request(method: string, args: unknown[]): Promise<unknown> {
    const id = crypto.randomUUID();
    this.worker.postMessage({ type: 'request', id, method, args } satisfies RequestMessage);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

export type { MarkitPlugin, MarkitPluginContext };
