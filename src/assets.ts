import { openKV, type KV } from './kv';

/**
 * Picture files for image items. An image item only holds the file's id
 * (`item.src`); the file itself is kept:
 * - in this browser, under the key-value key `asset:<id>` (a Blob in IndexedDB,
 *   a data URL in the localStorage fallback), so local boards work offline;
 * - on the niro server (`/api/assets/<id>`, server/assets.mjs) for boards kept
 *   with an account, so everyone on the board can load it.
 * Keeping files out of the board keeps the shared Yjs document small and fast.
 * Ids are 128 random bits (hard to guess), the same here and on the server.
 */

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ID = /^[a-f0-9]{32}$/;
export const isAssetId = (s: unknown): s is string => typeof s === 'string' && ID.test(s);

/** A new random file id (works on plain http too, unlike crypto.randomUUID). */
export function newAssetId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let kvPromise: Promise<KV> | null = null;
const store = () => (kvPromise ??= openKV());
const key = (id: string) => `asset:${id}`;

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export const dataUrlToBlob = (url: string): Promise<Blob> => fetch(url).then((r) => r.blob());

/** Keep a picture file in this browser. */
export async function saveAsset(id: string, blob: Blob): Promise<void> {
  const kv = await store();
  await kv.set(key(id), kv.kind === 'indexeddb' ? blob : await blobToDataUrl(blob));
}

/** The picture file kept in this browser, if any. */
export async function loadLocalAsset(id: string): Promise<Blob | null> {
  const raw = await (await store()).get<unknown>(key(id));
  if (raw instanceof Blob) return raw;
  if (typeof raw === 'string' && raw.startsWith('data:')) return dataUrlToBlob(raw);
  return null;
}

/** Forget a picture file in this browser. */
export async function deleteLocalAsset(id: string): Promise<void> {
  await (await store()).del(key(id));
}

/** Download a picture file from the server and keep it here. Null if the server doesn't have it (yet). */
async function fetchAsset(id: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/api/assets/${id}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const blob = await res.blob();
    void saveAsset(id, blob).catch(() => undefined);
    return blob;
  } catch {
    return null;
  }
}

/** A picture file: from this browser, else from the server. */
export async function getAsset(id: string): Promise<Blob | null> {
  return (await loadLocalAsset(id).catch(() => null)) ?? fetchAsset(id);
}

/** Send a picture file to the server. */
export async function uploadAsset(id: string, blob: Blob): Promise<boolean> {
  try {
    const res = await fetch(`/api/assets/${id}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function onServer(id: string): Promise<boolean> {
  try {
    return (await fetch(`/api/assets/${id}`, { method: 'HEAD', credentials: 'same-origin' })).ok;
  } catch {
    return false;
  }
}

/**
 * Make sure the server has these picture files (for a board kept with an
 * account): any it lacks are uploaded from this browser. Returns false if some
 * couldn't be uploaded (server down, file only on another device).
 */
export async function ensureOnServer(ids: string[]): Promise<boolean> {
  let ok = true;
  for (const id of new Set(ids.filter(isAssetId))) {
    if (await onServer(id)) continue;
    const blob = await loadLocalAsset(id).catch(() => null);
    if (!blob || !(await uploadAsset(id, blob))) ok = false;
  }
  return ok;
}

// ---------- URLs for showing pictures ----------

const urls = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();

/** An object URL for a picture file, or null if it can't be found (yet). */
export function assetUrl(id: string): Promise<string | null> {
  const known = urls.get(id);
  if (known) return Promise.resolve(known);
  let p = loading.get(id);
  if (!p) {
    p = getAsset(id).then((blob) => {
      loading.delete(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urls.set(id, url);
      return url;
    });
    loading.set(id, p);
  }
  return p;
}

/** Already-loaded object URL (no waiting). */
export const cachedAssetUrl = (id: string | undefined) => (id ? urls.get(id) : undefined);

/** Picture files as data URLs, for image export and JSON files (missing ones are left out). */
export async function assetDataUrls(ids: Iterable<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set(ids)) {
    if (!isAssetId(id)) continue;
    const blob = await getAsset(id);
    if (blob) out[id] = await blobToDataUrl(blob);
  }
  return out;
}

/** Keep picture files that came as data URLs (from a JSON file) in this browser. */
export async function saveDataUrls(assets: Record<string, string>): Promise<void> {
  for (const [id, url] of Object.entries(assets)) {
    if (isAssetId(id) && typeof url === 'string' && url.startsWith('data:image/')) await saveAsset(id, await dataUrlToBlob(url));
  }
}
