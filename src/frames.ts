import type { Box, Item } from './types';

type ItemMap = Record<string, Item | undefined>;

export const isFrame = (it: Item | undefined): it is Item => it?.type === 'frame';

const centerInside = (it: Box, f: Box) => {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
};

const area = (b: Box) => b.w * b.h;

/**
 * The frame `it` belongs to: the smallest frame its center is inside. Frames
 * nest the same way, but only inside a strictly larger frame, so a frame can
 * never end up inside itself or its own children.
 */
export function parentFrame(it: Item, frames: Item[]): Item | undefined {
  let best: Item | undefined;
  for (const f of frames) {
    if (f.id === it.id || !centerInside(it, f)) continue;
    if (isFrame(it) && area(f) <= area(it)) continue;
    if (!best || area(f) < area(best)) best = f;
  }
  return best;
}

/** Map of item id → id of the frame it belongs to (items in no frame are left out). */
export function frameParents(items: ItemMap, order: string[]): Map<string, string> {
  const frames = order.map((id) => items[id]).filter(isFrame);
  const parents = new Map<string, string>();
  if (!frames.length) return parents;
  for (const id of order) {
    const it = items[id];
    const p = it && parentFrame(it, frames);
    if (p) parents.set(id, p.id);
  }
  return parents;
}

/**
 * Everything inside any of `frameIds`, including nested frames and their
 * contents, in z-order. Membership is geometric (see `parentFrame`).
 */
export function frameChildren(frameIds: string[], items: ItemMap, order: string[]): string[] {
  const roots = new Set(frameIds.filter((id) => isFrame(items[id])));
  if (!roots.size) return [];
  const parents = frameParents(items, order);
  return order.filter((id) => {
    if (roots.has(id)) return false;
    // Walk up the frame chain; the size rule in `parentFrame` rules out loops.
    for (let p = parents.get(id); p; p = parents.get(p)) {
      if (roots.has(p)) return true;
    }
    return false;
  });
}

/** `ids` plus the contents of any frames among them, nested ones included (no duplicates). */
export function withFrameChildren(ids: string[], items: ItemMap, order: string[]): string[] {
  const kids = frameChildren(ids, items, order);
  return kids.length ? Array.from(new Set([...ids, ...kids])) : ids;
}

/** How many frames `id` is nested in. */
function depth(id: string, parents: Map<string, string>): number {
  let d = 0;
  for (let p = parents.get(id); p; p = parents.get(p)) d++;
  return d;
}

/**
 * Frames always draw behind everything else, outer frames behind the frames
 * nested in them; otherwise the z-order is kept.
 */
export function renderOrder(order: string[], items: ItemMap): string[] {
  const frames = order.filter((id) => isFrame(items[id]));
  if (!frames.length) return order;
  // Runs on every store change: only frame-in-frame parents matter here.
  const parents = frameParents(items, frames);
  const sorted = frames
    .map((id, i) => ({ id, i, d: depth(id, parents) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((f) => f.id);
  return [...sorted, ...order.filter((id) => !isFrame(items[id]))];
}

/**
 * Top-level frames in reading order, used as presentation slides: rows from
 * top to bottom, left to right within a row. A frame starts a new row when its
 * top is below the middle of the row's first frame.
 */
export function slideFrames(items: ItemMap, order: string[]): Item[] {
  const frames = order.map((id) => items[id]).filter(isFrame);
  const top = frames.filter((f) => !parentFrame(f, frames)).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const f of top) {
    const row = rows[rows.length - 1];
    if (row && f.y <= row[0].y + row[0].h / 2) row.push(f);
    else rows.push([f]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
