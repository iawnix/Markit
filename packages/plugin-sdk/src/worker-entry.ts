interface RequestMessage { type: 'request'; id: string; method: string; args: unknown[] }
interface ResponseMessage { type: 'response'; id: string; ok: boolean; value?: unknown; error?: string }

const scope = globalThis as unknown as { postMessage(message: unknown): void; addEventListener(type: 'message', listener: (event: MessageEvent) => void | Promise<void>): void };
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
let activePlugin: { deactivate?(): void | Promise<void> } | null = null;
const commands = new Map<string, { run(...args: unknown[]): void | Promise<void> }>();
const panels = new Set<string>();

function request(method: string, args: unknown[]): Promise<unknown> {
  const id = crypto.randomUUID();
  scope.postMessage({ type: 'request', id, method, args } satisfies RequestMessage);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

scope.addEventListener('message', async event => {
  const message = event.data as RequestMessage | ResponseMessage;
  if (message.type === 'response') {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.ok ? request.resolve(message.value) : request.reject(new Error(message.error || 'Plugin request failed.'));
    return;
  }
  if (message.method === 'activate') {
    try {
      const [manifest, entrySource] = message.args as [{ permissions: string[] }, string];
      const url = URL.createObjectURL(new Blob([entrySource], { type: 'text/javascript' }));
      const module = await import(/* @vite-ignore */ url) as { default?: { activate?(context: unknown): void | Promise<void> } };
      URL.revokeObjectURL(url);
      const plugin = module.default;
      if (!plugin || typeof plugin.activate !== 'function') throw new Error('Plugin entry must export a default activate function.');
      const context = {
        manifest,
        hasPermission: (permission: string) => manifest.permissions.includes(permission),
        registerCommand: (command: { id: string; title: string; shortcut?: string; visible?: boolean; run(...args: unknown[]): void | Promise<void> }) => {
          commands.set(command.id, command);
          void request('commands.register', [{ id: command.id, title: command.title, shortcut: command.shortcut, visible: command.visible }]);
          return () => { commands.delete(command.id); void request('commands.unregister', [command.id]); };
        },
        registerPanel: (panel: { id: string; title: string; attribution?: string; searchCommand?: string; initialContent?: { status?: string; items?: unknown[] }; mount(container: HTMLElement): () => void }) => {
          panels.add(panel.id);
          void request('panels.register', [{ id: panel.id, title: panel.title, attribution: panel.attribution, searchCommand: panel.searchCommand, initialContent: panel.initialContent }]);
          return () => { panels.delete(panel.id); void request('panels.unregister', [panel.id]); };
        },
        readDocument: () => request('document.read', []),
        updateDocument: (source: string) => request('document.update', [source]),
        fetch: (url: string, init?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }) => request('network.fetch', [url, init || {}]),
        updatePanel: (panelId: string, content: { status?: string; items?: unknown[] }) => request('panels.update', [panelId, content]),
        readSetting: (key: string) => request('settings.get', [key]),
        writeSetting: (key: string, value: string) => request('settings.set', [key, value]),
      };
      await plugin.activate(context);
      activePlugin = plugin;
      scope.postMessage({ type: 'response', id: message.id, ok: true } satisfies ResponseMessage);
    } catch (error) {
      scope.postMessage({ type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ResponseMessage);
    }
    return;
  }
  if (message.method === 'deactivate') {
    try { await activePlugin?.deactivate?.(); activePlugin = null; commands.clear(); panels.clear(); scope.postMessage({ type: 'response', id: message.id, ok: true } satisfies ResponseMessage); }
    catch (error) { scope.postMessage({ type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ResponseMessage); }
    return;
  }
  if (message.method === 'command.execute') {
    try {
      const id = message.args[0];
      const args = Array.isArray(message.args[1]) ? message.args[1] : [];
      if (typeof id !== 'string' || !commands.has(id)) throw new Error('Plugin command is unavailable.');
      await commands.get(id)?.run(...args);
      scope.postMessage({ type: 'response', id: message.id, ok: true } satisfies ResponseMessage);
    } catch (error) {
      scope.postMessage({ type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ResponseMessage);
    }
    return;
  }
  scope.postMessage({ type: 'response', id: message.id, ok: false, error: 'Unknown plugin method.' } satisfies ResponseMessage);
});

export { request };
