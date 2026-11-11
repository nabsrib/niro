import type { Box, Camera, Connector, Endpoint, Item } from './types';
import { boundsOf, intersects } from './geometry';
import { LABEL_DEFAULTS } from './connectors';

/**
 * Viewport culling: only items and connectors near the screen get rendered.
 * Pure helpers; the store keeps every item, this only decides what to draw.
 */

type ItemMap = Record<string, Item | undefined>;

/**
 * World-space area to render: the visible area plus at least half a screen on
 * each side, snapped outward to a coarse grid. The grid makes the area change
 * only when the view crosses a cell boundary, not on every pan frame, so the
 * rendered list rarely changes while panning. Cell size is a power of two at
 * least one screen wide, so zooming changes it in steps too.
 * Returns null before the viewport has been measured (render everything).
 */
export function cullRect(camera: Camera, viewport: { w: number; h: number }): Box | null {
  if (viewport.w <= 0 || viewport.h <= 0) return null;
  const vw = viewport.w / camera.z;
  const vh = viewport.h / camera.z;
  const vx = -camera.x / camera.z;
  const vy = -camera.y / camera.z;
  const cell = Math.pow(2, Math.ceil(Math.log2(Math.max(vw, vh))));
  const x1 = Math.floor((vx - vw / 2) / cell) * cell;
  const y1 = Math.floor((vy - vh / 2) / cell) * cell;
  const x2 = Math.ceil((vx + vw * 1.5) / cell) * cell;
  const y2 = Math.ceil((vy + vh * 1.5) / cell) * cell;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Ids rendered even when off screen: the selection (toolbar, nudging) and the open editor. */
export function keepRendered(selected: string[], editingId: string | null): Set<string> {
  const keep = new Set(selected);
  if (editingId) keep.add(editingId);
  return keep;
}

/**
 * The ids from `ids` (kept in their order) whose box touches `rect`, plus any
 * in `keep` (e.g. selected or being edited) wherever they are.
 */
export function visibleItems(ids: string[], items: ItemMap, rect: Box | null, keep: Set<string>): string[] {
  if (!rect) return ids;
  return ids.filter((id) => {
    const it = items[id];
    return !!it && (keep.has(id) || intersects(it, rect));
  });
}

const endBox = (e: Endpoint, items: ItemMap): Box | null =>
  e.kind === 'point' ? { x: e.x, y: e.y, w: 0, h: 0 } : (items[e.itemId] ?? null);

/**
 * A cheap box that surely contains a connector, without computing its path:
 * the box around both ends, padded for elbow detours, curves (more for a
 * dragged bend) and the label.
 */
export function connectorCullBox(c: Connector, items: ItemMap): Box | null {
  const a = endBox(c.from, items);
  const b = endBox(c.to, items);
  if (!a || !b) return null;
  const box = boundsOf([a, b])!;
  const span = Math.hypot(box.w, box.h);
  let pad = 100 + c.strokeWidth * 4;
  if (c.style === 'curved') pad += span * (0.5 + Math.abs(c.bend?.offset ?? 0));
  if (c.label) pad += (c.labelSize ?? LABEL_DEFAULTS.size) * 10;
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

/** Connector ids to render: near `rect`, or in `keep` (e.g. selected or being edited). */
export function visibleConnectors(
  connectors: Record<string, Connector>,
  items: ItemMap,
  rect: Box | null,
  keep: Set<string>,
): string[] {
  const ids = Object.keys(connectors);
  if (!rect) return ids;
  return ids.filter((id) => {
    if (keep.has(id)) return true;
    const box = connectorCullBox(connectors[id], items);
    return !!box && intersects(box, rect);
  });
}
