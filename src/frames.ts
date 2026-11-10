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
 * Top-level frames in presentation order (decks not yet expanded). Frames the
 * user ordered (`slide` set) come first; the rest follow in reading order:
 * rows from top to bottom, left to right within a row (a frame starts a new
 * row when its top is below the middle of the row's first frame).
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
  const reading = rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
  // Stable sort: equal keys (e.g. a duplicated frame) keep reading order.
  return reading.sort((a, b) => (a.slide ?? Infinity) - (b.slide ?? Infinity));
}

// ---------- slide decks ----------

/** Slide deck layout (world units): padding inside the deck, gap between slides, default slide size. */
export const DECK = { pad: 60, gap: 60, slideW: 960, slideH: 540 };

/** A slide deck: a frame (`deck: true`) whose child frames are laid out in one row as slides. */
// Plain boolean, not a type guard: a guard would narrow a non-deck frame to `never`.
export const isDeck = (it: Item | undefined): boolean => isFrame(it) && !!it.deck;

/** Slides of a deck: frames directly inside it, left to right (by center). */
export function deckSlides(deck: Item, items: ItemMap, order: string[]): Item[] {
  const frameIds = order.filter((id) => isFrame(items[id]));
  const parents = frameParents(items, frameIds);
  return frameIds
    .map((id) => items[id])
    .filter((f): f is Item => !!f && parents.get(f.id) === deck.id)
    .sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
}

/**
 * Patches that lay a deck out: its slides in one row in the given order
 * (each carrying its contents), and the deck resized to wrap them. `carry`
 * overrides what a slide carries (e.g. a frame being dropped in, whose
 * contents were fixed when the drag started).
 */
export function layoutDeck(
  deck: Item,
  slides: Item[],
  items: ItemMap,
  order: string[],
  carry: Record<string, string[]> = {},
): Record<string, Partial<Item>> {
  const patches: Record<string, Partial<Item>> = {};
  let x = deck.x + DECK.pad;
  const top = deck.y + DECK.pad;
  let maxH = 0;
  for (const slide of slides) {
    const dx = x - slide.x;
    const dy = top - slide.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      for (const id of [slide.id, ...(carry[slide.id] ?? frameChildren([slide.id], items, order))]) {
        const it = items[id];
        if (it) patches[id] = { x: it.x + dx, y: it.y + dy };
      }
    }
    x += slide.w + DECK.gap;
    maxH = Math.max(maxH, slide.h);
  }
  const w = slides.length ? x - DECK.gap + DECK.pad - deck.x : DECK.slideW + DECK.pad * 2;
  const h = (slides.length ? maxH : DECK.slideH) + DECK.pad * 2;
  if (Math.abs(w - deck.w) > 0.01 || Math.abs(h - deck.h) > 0.01) patches[deck.id] = { w, h };
  return patches;
}

/**
 * Where a frame dragged over a deck would be inserted: the slide index (by the
 * pointer's x against slide centers) and the insertion line in world space,
 * centered in the gap. `slides` must not include the dragged frame.
 */
export function deckInsertion(
  deck: Item,
  slides: Item[],
  x: number,
): { index: number; line: { x: number; y1: number; y2: number } } {
  const index = slides.filter((f) => f.x + f.w / 2 < x).length;
  const prev = slides[index - 1];
  const next = slides[index];
  const lineX = prev
    ? prev.x + prev.w + DECK.gap / 2
    : next
      ? next.x - DECK.gap / 2
      : deck.x + DECK.pad / 2;
  return { index, line: { x: lineX, y1: deck.y + DECK.pad, y2: deck.y + deck.h - DECK.pad } };
}

/**
 * Every slide in presentation order, hidden ones included: top-level frames in
 * `slideFrames` order, with each deck replaced by its slides.
 */
export function slideList(items: ItemMap, order: string[]): Item[] {
  return slideFrames(items, order).flatMap((f) => (isDeck(f) ? deckSlides(f, items, order) : [f]));
}

/** The slides a presentation shows: `slideList` minus slides hidden from it. */
export function presentationSlides(items: ItemMap, order: string[]): Item[] {
  return slideList(items, order).filter((f) => !f.skipSlide);
}

// ---------- frame presets ----------

export type FramePreset = 'custom' | '16:9' | '4:3' | '1:1' | 'a4' | 'phone' | 'slides';

/** Frame tool presets: click places a frame of this size (custom: default size, or drag to size). */
export const FRAME_PRESETS: { id: FramePreset; label: string; w: number; h: number }[] = [
  { id: 'custom', label: 'Custom', w: 640, h: 360 },
  { id: '16:9', label: '16:9', w: 960, h: 540 },
  { id: '4:3', label: '4:3', w: 800, h: 600 },
  { id: '1:1', label: '1:1', w: 600, h: 600 },
  { id: 'a4', label: 'A4', w: 595, h: 842 },
  { id: 'phone', label: 'Phone', w: 390, h: 844 },
  { id: 'slides', label: 'Slides', w: DECK.slideW, h: DECK.slideH },
];
