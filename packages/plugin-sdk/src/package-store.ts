const DATABASE = 'markit-plugin-packages';
const STORE = 'entries';
const VERSION = 1;

interface StoredEntry { id: string; source: string }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onerror = () => reject(request.error || new Error('Unable to open plugin storage.'));
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
  });
}

export async function savePluginEntry(id: string, source: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put({ id, source } satisfies StoredEntry);
    request.onerror = () => reject(request.error || new Error('Unable to save plugin package.'));
    request.onsuccess = () => resolve();
  });
  db.close();
}

export async function loadPluginEntry(id: string): Promise<string | null> {
  const db = await database();
  const value = await new Promise<StoredEntry | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onerror = () => reject(request.error || new Error('Unable to load plugin package.'));
    request.onsuccess = () => resolve(request.result as StoredEntry | undefined);
  });
  db.close();
  return value?.source || null;
}

export async function removePluginEntry(id: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    request.onerror = () => reject(request.error || new Error('Unable to remove plugin package.'));
    request.onsuccess = () => resolve();
  });
  db.close();
}
