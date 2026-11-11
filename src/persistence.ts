import type { Camera, Connector, Endpoint, Item } from './types';

/** Where versions before multiple boards saved the single board. */
const KEY = 'niro:board:v1';

export interface SavedBoard {
  items: Record<string, Item>;
  order: string[];
  connectors: Record<string, Connector>;
  camera: Camera;
}

/**
 * Check saved board data and drop dangling references, so a corrupted save
 * cannot break rendering. Returns null if it isn't board data at all.
 */
export function sanitizeBoard(raw: unknown): SavedBoard | null {
  const data = raw as SavedBoard | null;
  if (!data || typeof data.items !== 'object' || !Array.isArray(data.order)) return null;
  const order = data.order.filter((id) => data.items[id]);
  const valid = (e: Endpoint | undefined) =>
    !!e && (e.kind === 'point' || (e.kind === 'item' && !!data.items[e.itemId]));
  const connectors: Record<string, Connector> = {};
  for (const c of Object.values(data.connectors ?? {})) {
    if (valid(c.from) && valid(c.to)) connectors[c.id] = c;
  }
  return { items: data.items, order, connectors, camera: data.camera };
}

/**
 * The board saved by older versions (one board in localStorage). Read once to
 * migrate it into the boards list (boards.ts); the old copy is kept as a backup.
 */
export function loadLegacyBoard(): SavedBoard | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeBoard(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
