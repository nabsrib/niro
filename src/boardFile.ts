import type { Bend, Connector, Endpoint, Item, ItemType, Side, Vec } from './types';
import { MIN_ITEM_SIZE, boundsOf, uid } from './geometry';
import { CONNECTOR_DEFAULTS, LABEL_DEFAULTS } from './connectors';
import { ITEM_DEFAULTS } from './defaults';

/**
 * JSON file format for exporting/importing a board.
 *
 *   { "format": "niro-board", "version": 1, "exportedAt": "...",
 *     "items": [...in z-order...], "connectors": [...] }
 *
 * Import also accepts the app's localStorage shape ({ items: {id: item}, order }).
 */
export const FILE_FORMAT = 'niro-board';
export const FILE_VERSION = 1;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Upper bound on numbers in one pen stroke (x/y pairs). */
const MAX_PATH_VALUES = 200_000;

export interface BoardFile {
  format: typeof FILE_FORMAT;
  version: number;
  exportedAt: string;
  items: Item[];
  connectors: Connector[];
}

export interface BoardContent {
  items: Item[];
  connectors: Connector[];
}

// ---------- export ----------

export function serializeBoard(
  items: Record<string, Item>,
  order: string[],
  connectors: Record<string, Connector>,
): string {
  const file: BoardFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    items: order.map((id) => items[id]).filter(Boolean),
    connectors: Object.values(connectors),
  };
  return JSON.stringify(file, null, 2);
}

/** Save `json` as a .json file through the browser's download flow. */
export function downloadJson(json: string, name: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportFileName = () => `niro-board-${new Date().toISOString().slice(0, 10)}.json`;

// ---------- import ----------

const ITEM_TYPES = Object.keys(ITEM_DEFAULTS) as ItemType[];
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const color = (v: unknown, fallback: string) =>
  typeof v === 'string' && /^(#[0-9a-f]{3,8}|transparent)$/i.test(v) ? v : fallback;

function sanitizeItem(raw: unknown): Item | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const type = raw.type as ItemType;
  if (!ITEM_TYPES.includes(type)) return null;
  const d = ITEM_DEFAULTS[type];
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;

  // Pen strokes need a valid list of normalized points.
  let pen: Pick<Item, 'points' | 'strokeWidth' | 'highlight'> = {};
  if (type === 'path') {
    const pts = raw.points;
    if (
      !Array.isArray(pts) ||
      pts.length < 2 ||
      pts.length % 2 !== 0 ||
      pts.length > MAX_PATH_VALUES ||
      !pts.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return null;
    }
    pen = {
      points: pts as number[],
      strokeWidth: Math.min(Math.max(num(raw.strokeWidth, d.strokeWidth ?? 3), 0.05), 1000),
      ...(raw.highlight === true ? { highlight: true } : {}),
    };
  }
  // Thin strokes (e.g. a straight line) may legitimately be narrower than shapes.
  const minSize = type === 'path' ? 0.5 : MIN_ITEM_SIZE;

  return {
    ...pen,
    id: raw.id,
    type,
    x: raw.x as number,
    y: raw.y as number,
    w: Math.max(num(raw.w, d.w), minSize),
    h: Math.max(num(raw.h, d.h), minSize),
    fill: color(raw.fill, d.fill),
    color: color(raw.color, d.color),
    text: str(raw.text, d.text).slice(0, 100_000),
    fontSize: Math.min(Math.max(num(raw.fontSize, d.fontSize), 1), 2000),
  };
}

function sanitizeEndpoint(raw: unknown, itemIds: Set<string>): Endpoint | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'point') {
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
    return { kind: 'point', x: raw.x as number, y: raw.y as number };
  }
  if (raw.kind === 'item' && typeof raw.itemId === 'string' && itemIds.has(raw.itemId)) {
    const side = SIDES.includes(raw.side as Side) ? (raw.side as Side) : null;
    return { kind: 'item', itemId: raw.itemId, side };
  }
  return null;
}

function sanitizeConnector(raw: unknown, itemIds: Set<string>): Connector | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const from = sanitizeEndpoint(raw.from, itemIds);
  const to = sanitizeEndpoint(raw.to, itemIds);
  if (!from || !to) return null;
  const d = CONNECTOR_DEFAULTS;
  const bend: Bend | null =
    isObj(raw.bend) && Number.isFinite(raw.bend.along) && Number.isFinite(raw.bend.offset)
      ? { along: raw.bend.along as number, offset: raw.bend.offset as number }
      : null;
  return {
    id: raw.id,
    from,
    to,
    style: raw.style === 'straight' || raw.style === 'elbow' || raw.style === 'curved' ? raw.style : d.style,
    stroke: color(raw.stroke, d.stroke),
    strokeWidth: Math.min(Math.max(num(raw.strokeWidth, d.strokeWidth), 0.5), 50),
    startArrow: raw.startArrow === 'arrow' ? 'arrow' : 'none',
    endArrow: raw.endArrow === 'none' ? 'none' : 'arrow',
    bend,
    ...(typeof raw.label === 'string' && raw.label.trim() ? { label: raw.label.slice(0, 10_000) } : {}),
    ...(Number.isFinite(raw.labelAt) ? { labelAt: Math.min(Math.max(raw.labelAt as number, 0), 1) } : {}),
    ...(Number.isFinite(raw.labelSize) ? { labelSize: Math.min(Math.max(raw.labelSize as number, 4), 400) } : {}),
    ...(typeof raw.labelColor === 'string' ? { labelColor: color(raw.labelColor, LABEL_DEFAULTS.color) } : {}),
  };
}

export interface ParseResult extends BoardContent {
  /** Entries that were invalid and left out. */
  skipped: number;
}

/** Parse and validate a board file. Throws an Error with a user-facing message. */
export function parseBoard(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isObj(data)) throw new Error('This file does not contain a board.');
  if (data.format !== undefined && data.format !== FILE_FORMAT) {
    throw new Error('This JSON file is not a niro board.');
  }
  if (typeof data.version === 'number' && data.version > FILE_VERSION) {
    throw new Error('This board was saved by a newer version of niro.');
  }

  // Items: an array in z-order, or the localStorage record + order shape.
  let rawItems: unknown[];
  if (Array.isArray(data.items)) {
    rawItems = data.items;
  } else if (isObj(data.items)) {
    const record = data.items;
    const order = Array.isArray(data.order) ? (data.order as unknown[]) : Object.keys(record);
    rawItems = order.map((id) => (typeof id === 'string' ? record[id] : undefined));
  } else {
    throw new Error('This file does not contain a board.');
  }
  const rawConnectors = Array.isArray(data.connectors)
    ? data.connectors
    : isObj(data.connectors)
      ? Object.values(data.connectors)
      : [];

  const items: Item[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const it = sanitizeItem(raw);
    if (it && !seen.has(it.id)) {
      seen.add(it.id);
      items.push(it);
    }
  }
  const connectors: Connector[] = [];
  for (const raw of rawConnectors) {
    const c = sanitizeConnector(raw, seen);
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      connectors.push(c);
    }
  }
  const skipped = rawItems.length + rawConnectors.length - items.length - connectors.length;
  if (!items.length && !connectors.length) throw new Error('This board file is empty.');
  return { items, connectors, skipped };
}

export async function readBoardFile(file: File): Promise<ParseResult> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is too large (over 20 MB).');
  return parseBoard(await file.text());
}

/**
 * Give imported content fresh ids (so it can sit next to existing items) and
 * move it so its bounds are centered on `center`.
 */
export function prepareForInsert(content: BoardContent, center: Vec): BoardContent {
  const freePoints = content.connectors
    .flatMap((c) => [c.from, c.to])
    .filter((e): e is Extract<Endpoint, { kind: 'point' }> => e.kind === 'point')
    .map((e) => ({ x: e.x, y: e.y, w: 0, h: 0 }));
  const b = boundsOf([...content.items, ...freePoints]) ?? { x: 0, y: 0, w: 0, h: 0 };
  const dx = center.x - (b.x + b.w / 2);
  const dy = center.y - (b.y + b.h / 2);
  const idMap = new Map<string, string>();
  const items = content.items.map((it) => {
    const id = uid();
    idMap.set(it.id, id);
    return { ...it, id, x: it.x + dx, y: it.y + dy };
  });
  const move = (e: Endpoint): Endpoint =>
    e.kind === 'item'
      ? { ...e, itemId: idMap.get(e.itemId) ?? e.itemId }
      : { kind: 'point', x: e.x + dx, y: e.y + dy };
  const connectors = content.connectors.map((c) => ({ ...c, id: uid(), from: move(c.from), to: move(c.to) }));
  return { items, connectors };
}
