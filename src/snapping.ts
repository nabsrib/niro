import type { Box, Vec } from './types';

/** Screen pixels within which an edge or center snaps to another item. */
export const SNAP_DISTANCE = 6;

/**
 * An alignment guide in world coordinates. `axis: 'x'` is a vertical line at
 * x = `at` running from y = `from` to y = `to`; `axis: 'y'` is horizontal.
 */
export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number };

const xStops = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const yStops = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

/** Closest target value to any of `values` within `threshold`, as an offset (null if none). */
function bestOffset(values: number[], targets: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const v of values) {
    for (const t of targets) {
      const d = Math.abs(t - v);
      if (d < bestDist) {
        bestDist = d;
        best = t - v;
      }
    }
  }
  return best;
}

/** Offset that aligns the edges/center of `box` with nearby `targets`. */
export function snapBox(box: Box, targets: Box[], threshold: number): Vec {
  return {
    x: bestOffset(xStops(box), targets.flatMap(xStops), threshold) ?? 0,
    y: bestOffset(yStops(box), targets.flatMap(yStops), threshold) ?? 0,
  };
}

/** Snap a single coordinate (e.g. the edge being resized) to target edges/centers. */
export function snapValue(v: number, targets: Box[], axis: 'x' | 'y', threshold: number): number {
  const stops = targets.flatMap(axis === 'x' ? xStops : yStops);
  return v + (bestOffset([v], stops, threshold) ?? 0);
}

/** Guides for every edge/center of `box` that lines up with a target. */
export function alignmentGuides(box: Box, targets: Box[], eps = 0.5): Guide[] {
  const guides: Guide[] = [];
  const build = (axis: 'x' | 'y') => {
    const stops = axis === 'x' ? xStops : yStops;
    // Guides run along the other axis, spanning everything that lines up.
    const span = (b: Box): [number, number] => (axis === 'x' ? [b.y, b.y + b.h] : [b.x, b.x + b.w]);
    for (const at of stops(box)) {
      let [from, to] = span(box);
      let hit = false;
      for (const t of targets) {
        if (stops(t).some((s) => Math.abs(s - at) <= eps)) {
          const [f, e] = span(t);
          from = Math.min(from, f);
          to = Math.max(to, e);
          hit = true;
        }
      }
      if (hit && !guides.some((g) => g.axis === axis && Math.abs(g.at - at) <= eps)) {
        guides.push({ axis, at, from, to });
      }
    }
  };
  build('x');
  build('y');
  return guides;
}

// ---------- equal spacing ----------

/**
 * A gap marker in world coordinates: along `axis`, the empty space from `from`
 * to `to`, drawn across the other axis at `at`. Shown in pairs (or more) when
 * gaps are equal.
 */
export type Gap = { axis: 'x' | 'y'; from: number; to: number; at: number };

type Axis = 'x' | 'y';
const start = (b: Box, a: Axis) => (a === 'x' ? b.x : b.y);
const size = (b: Box, a: Axis) => (a === 'x' ? b.w : b.h);
const end = (b: Box, a: Axis) => start(b, a) + size(b, a);
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
/** Whether two boxes overlap on the given axis. */
const overlapOn = (p: Box, q: Box, a: Axis) => start(p, a) < end(q, a) && end(p, a) > start(q, a);

/**
 * Neighbors of `box` along `axis`: targets in the same row (x) or column (y),
 * i.e. overlapping it on the other axis. Each side lists the nearest first.
 * Targets overlapping the box on both axes (e.g. a frame around it) are ignored.
 */
function neighbors(box: Box, targets: Box[], a: Axis): { before: Box[]; after: Box[] } {
  const o = other(a);
  const mid = start(box, a) + size(box, a) / 2;
  const lane = targets.filter((t) => overlapOn(t, box, o) && !overlapOn(t, box, a));
  const before = lane.filter((t) => end(t, a) <= mid).sort((p, q) => end(q, a) - end(p, a));
  const after = lane.filter((t) => start(t, a) >= mid).sort((p, q) => start(p, a) - start(q, a));
  return { before, after };
}

/** Nearest box on the far side of `b`, in the same row/column as `b`. */
function nextOut(b: Box, side: 'before' | 'after', targets: Box[], a: Axis): Box | undefined {
  const { before, after } = neighbors(b, targets, a);
  return side === 'before' ? before[0] : after[0];
}

/** Gap between two boxes along `a` (p before q), with its marker. */
function gapBetween(p: Box, q: Box, a: Axis): { size: number; marker: Gap } {
  const o = other(a);
  const lo = Math.max(start(p, o), start(q, o));
  const hi = Math.min(end(p, o), end(q, o));
  const at = lo <= hi ? (lo + hi) / 2 : (start(q, o) + end(q, o)) / 2;
  return { size: start(q, a) - end(p, a), marker: { axis: a, from: end(p, a), to: start(q, a), at } };
}

/**
 * Positions along `a` where `box` would have equal spacing: centered between
 * its nearest neighbors, or repeating the gap next to a neighbor (A–B is 40,
 * so C goes 40 past B). Returns the offset to the closest one within
 * `threshold`, or null.
 */
function spacingOffset(box: Box, targets: Box[], a: Axis, threshold: number): number | null {
  const { before, after } = neighbors(box, targets, a);
  const L = before[0];
  const R = after[0];
  const pos = start(box, a);
  const w = size(box, a);
  const candidates: number[] = [];
  if (L && R) {
    const room = start(R, a) - end(L, a) - w;
    if (room >= 0) candidates.push(end(L, a) + room / 2);
  }
  if (L) {
    const LL = nextOut(L, 'before', targets, a);
    if (LL) candidates.push(end(L, a) + gapBetween(LL, L, a).size);
  }
  if (R) {
    const RR = nextOut(R, 'after', targets, a);
    if (RR) candidates.push(start(R, a) - gapBetween(R, RR, a).size - w);
  }
  let best: number | null = null;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - pos);
    if (d < bestDist) {
      bestDist = d;
      best = c - pos;
    }
  }
  return best;
}

/** Gap markers for every set of equal gaps `box` is part of, on both axes. */
export function spacingGaps(box: Box, targets: Box[], eps = 0.5): Gap[] {
  const out: Gap[] = [];
  for (const a of ['x', 'y'] as const) {
    const { before, after } = neighbors(box, targets, a);
    const L = before[0];
    const R = after[0];
    const left = L && gapBetween(L, box, a);
    const right = R && gapBetween(box, R, a);
    const add = (...gs: { marker: Gap }[]) => {
      for (const g of gs) if (!out.includes(g.marker)) out.push(g.marker);
    };
    if (left && right && left.size >= 0 && Math.abs(left.size - right.size) <= eps) add(left, right);
    const LL = L && nextOut(L, 'before', targets, a);
    if (left && LL && left.size >= 0) {
      const g = gapBetween(LL, L, a);
      if (Math.abs(g.size - left.size) <= eps) add(g, left);
    }
    const RR = R && nextOut(R, 'after', targets, a);
    if (right && RR && right.size >= 0) {
      const g = gapBetween(R, RR, a);
      if (Math.abs(g.size - right.size) <= eps) add(right, g);
    }
  }
  return out;
}

/**
 * Snapping for a moved box: per axis, whichever pull is closer wins, aligning
 * edges/centers or equal spacing. Returns the offset plus the alignment
 * guides and gap markers for where the box ends up.
 */
export function snapMove(box: Box, targets: Box[], threshold: number): { offset: Vec; guides: Guide[]; gaps: Gap[] } {
  const pick = (a: Axis) => {
    const stops = a === 'x' ? xStops : yStops;
    const align = bestOffset(stops(box), targets.flatMap(stops), threshold);
    const space = spacingOffset(box, targets, a, threshold);
    if (align === null) return space ?? 0;
    if (space === null) return align;
    return Math.abs(space) < Math.abs(align) ? space : align;
  };
  const offset = { x: pick('x'), y: pick('y') };
  const moved = { ...box, x: box.x + offset.x, y: box.y + offset.y };
  return { offset, guides: alignmentGuides(moved, targets), gaps: spacingGaps(moved, targets) };
}
