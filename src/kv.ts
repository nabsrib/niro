/**
 * Tiny key-value storage for boards. Uses IndexedDB (the browser's built-in
 * database: lots of space, saves in the background without freezing the page)
 * and falls back to localStorage when IndexedDB can't be opened (some private
 * browsing modes).
 */
export interface KV {
  kind: 'indexeddb' | 'localstorage';
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const DB_NAME = 'niro';
const STORE = 'kv';

/** Turn an IndexedDB request into a promise. */
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

function indexedDbKV(db: IDBDatabase): KV {
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    kind: 'indexeddb',
    get: <T,>(key: string) => done(store('readonly').get(key)) as Promise<T | undefined>,
    set: async (key, value) => {
      await done(store('readwrite').put(value, key));
    },
    del: async (key) => {
      await done(store('readwrite').delete(key));
    },
  };
}

const LS_PREFIX = 'niro:kv:';

function localStorageKV(): KV {
  return {
    kind: 'localstorage',
    get: async <T,>(key: string) => {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    },
    // Throws when storage is full; the caller shows a notice.
    set: async (key, value) => localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)),
    del: async (key) => localStorage.removeItem(LS_PREFIX + key),
  };
}

/** Open board storage: IndexedDB if possible, else localStorage. */
export async function openKV(): Promise<KV> {
  try {
    return indexedDbKV(await openIndexedDB());
  } catch {
    return localStorageKV();
  }
}
