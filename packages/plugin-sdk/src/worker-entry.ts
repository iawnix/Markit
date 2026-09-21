interface RequestMessage { type: 'request'; id: string; method: string; args: unknown[] }
interface ResponseMessage { type: 'response'; id: string; ok: boolean; value?: unknown; error?: string }

const scope = globalThis as unknown as { postMessage(message: unknown): void; addEventListener(type: 'message', listener: (event: MessageEvent) => void | Promise<void>): void };
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();

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
    // The entry module is loaded only after the host has validated its manifest.
    // A production loader will import the package entry from the installed bundle.
    scope.postMessage({ type: 'response', id: message.id, ok: true } satisfies ResponseMessage);
    return;
  }
  if (message.method === 'deactivate') { scope.postMessage({ type: 'response', id: message.id, ok: true } satisfies ResponseMessage); return; }
  scope.postMessage({ type: 'response', id: message.id, ok: false, error: 'Unknown plugin method.' } satisfies ResponseMessage);
});

export { request };
