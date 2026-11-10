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

/** Closest target value to any of `values` within `threshold`, as an offset. */
function bestOffset(values: number[], targets: number[], threshold: number): number {
  let best = 0;
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
    x: bestOffset(xStops(box), targets.flatMap(xStops), threshold),
    y: bestOffset(yStops(box), targets.flatMap(yStops), threshold),
  };
}

/** Snap a single coordinate (e.g. the edge being resized) to target edges/centers. */
export function snapValue(v: number, targets: Box[], axis: 'x' | 'y', threshold: number): number {
  const stops = targets.flatMap(axis === 'x' ? xStops : yStops);
  return v + bestOffset([v], stops, threshold);
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
