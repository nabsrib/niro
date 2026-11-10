import type { Camera, Connector, Endpoint, Item } from './types';

const KEY = 'niro:board:v1';

export interface SavedBoard {
  items: Record<string, Item>;
  order: string[];
  connectors: Record<string, Connector>;
  camera: Camera;
}

export function loadBoard(): SavedBoard | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedBoard;
    if (!data || typeof data.items !== 'object' || !Array.isArray(data.order)) return null;
    // Drop dangling references so a corrupted save cannot break rendering.
    data.order = data.order.filter((id) => data.items[id]);
    const valid = (e: Endpoint | undefined) =>
      !!e && (e.kind === 'point' || (e.kind === 'item' && !!data.items[e.itemId]));
    const connectors: Record<string, Connector> = {};
    for (const c of Object.values(data.connectors ?? {})) {
      if (valid(c.from) && valid(c.to)) connectors[c.id] = c;
    }
    data.connectors = connectors;
    return data;
  } catch {
    return null;
  }
}

export function saveBoard(board: SavedBoard) {
  try {
    localStorage.setItem(KEY, JSON.stringify(board));
  } catch {
    // Quota exceeded or storage blocked: the board just will not persist.
  }
}
