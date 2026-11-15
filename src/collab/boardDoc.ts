import * as Y from 'yjs';
import type { Connector, Item } from '../types';
import type { SavedBoard } from '../persistence';
import { sortByZ } from '../zorder';

/**
 * A board's content as a Yjs document: shared data that merges edits made in
 * several places (other tabs, other people) without losing any. Layout:
 * - `items`: item id → Y.Map of that item's fields, plus `z` (its z-order number,
 *   see zorder.ts). Each field merges on its own, so a move and a recolor made at
 *   the same time both survive.
 * - `connectors`: connector id → Y.Map of that connector's fields.
 * - `meta`: `version`, set once the document has been filled (from an older save,
 *   or empty for a new board).
 * The id is the map key, never stored as a field. Field values are plain JSON
 * (numbers, strings, pen points, rich text runs, endpoints). The camera is not in
 * here: each person has their own view.
 */
export const DOC_VERSION = 1;
/** Field holding an item's z-order number. */
export const Z = 'z';

export interface BoardDoc {
  doc: Y.Doc;
  items: Y.Map<Y.Map<unknown>>;
  connectors: Y.Map<Y.Map<unknown>>;
  meta: Y.Map<unknown>;
}

export interface DocContent {
  items: Record<string, Item>;
  order: string[];
  connectors: Record<string, Connector>;
}

export function createBoardDoc(): BoardDoc {
  const doc = new Y.Doc();
  return {
    doc,
    items: doc.getMap<Y.Map<unknown>>('items'),
    connectors: doc.getMap<Y.Map<unknown>>('connectors'),
    meta: doc.getMap<unknown>('meta'),
  };
}

/** True once the document holds a board (even an empty one). */
export function isFilled(bd: BoardDoc): boolean {
  return bd.meta.has('version');
}

/** An object's fields as Y.Map entries (no id, no z, no undefined values). */
export function fieldEntries(obj: object, extra?: Record<string, unknown>): [string, unknown][] {
  const out = Object.entries(obj).filter(([k, v]) => k !== 'id' && k !== Z && v !== undefined);
  return extra ? [...out, ...Object.entries(extra)] : out;
}

/** Write only the fields that differ between `prev` and `next` (absent or undefined = remove). */
export function writeFields(m: Y.Map<unknown>, next: object, prev: object): void {
  const n = next as Record<string, unknown>;
  const p = prev as Record<string, unknown>;
  for (const k in n) {
    if (k === 'id' || k === Z) continue;
    if (n[k] !== undefined && n[k] !== p[k]) m.set(k, n[k]);
  }
  for (const k in p) {
    if (k === 'id' || k === Z) continue;
    if (p[k] !== undefined && n[k] === undefined) m.delete(k);
  }
}

/** Read an item or connector back from its Y.Map. */
export function readFields<T>(id: string, m: Y.Map<unknown>): T {
  const o: Record<string, unknown> = { id };
  m.forEach((v, k) => {
    if (k !== Z) o[k] = v;
  });
  return o as unknown as T;
}

/** An item's z-order number (undefined if it has none yet). */
export function zOf(bd: BoardDoc, id: string): number | undefined {
  const z = bd.items.get(id)?.get(Z);
  return typeof z === 'number' ? z : undefined;
}

/**
 * Fill a new document from a board saved by an older version (or leave it
 * empty), and mark it filled. The z-order follows the old `order`.
 */
export function fillBoardDoc(bd: BoardDoc, saved: SavedBoard | null): void {
  bd.doc.transact(() => {
    if (saved) {
      saved.order.forEach((id, i) => {
        bd.items.set(id, new Y.Map<unknown>(fieldEntries(saved.items[id], { [Z]: i + 1 })));
      });
      for (const c of Object.values(saved.connectors)) {
        bd.connectors.set(c.id, new Y.Map<unknown>(fieldEntries(c)));
      }
    }
    bd.meta.set('version', DOC_VERSION);
  });
}

/** The board as store data: items, order (sorted by z) and connectors. */
export function readBoard(bd: BoardDoc): DocContent {
  const items: Record<string, Item> = {};
  bd.items.forEach((m, id) => {
    items[id] = readFields<Item>(id, m);
  });
  const connectors: Record<string, Connector> = {};
  bd.connectors.forEach((m, id) => {
    connectors[id] = readFields<Connector>(id, m);
  });
  const order = sortByZ(Object.keys(items), (id) => zOf(bd, id) ?? 0);
  return { items, order, connectors };
}

// ---------- storage ----------

/**
 * The whole document as one Yjs update, ready for the key-value store: bytes in
 * IndexedDB, base64 text when boards fall back to localStorage (which only holds text).
 */
export function encodeBoardDoc(bd: BoardDoc, asText: boolean): Uint8Array | string {
  const update = Y.encodeStateAsUpdate(bd.doc);
  return asText ? toBase64(update) : update;
}

/**
 * Load stored data (from `encodeBoardDoc`) into the document. Returns false when
 * nothing usable was stored; throws when the data is broken.
 */
export function decodeIntoBoardDoc(bd: BoardDoc, raw: unknown): boolean {
  const update = raw instanceof Uint8Array ? raw : typeof raw === 'string' ? fromBase64(raw) : null;
  if (!update) return false;
  Y.applyUpdate(bd.doc, update, 'load');
  return true;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
