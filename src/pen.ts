import type { Item, Vec } from './types';
import { uid } from './geometry';

export const PEN_COLORS = ['#1A1A1A', '#E5383B', '#F28C28', '#2BA84A', '#2F6FED', '#8E44D9'];
/** Pen widths in screen pixels at the zoom level the stroke is drawn at. */
export const PEN_WIDTHS = [2, 4, 8];
export const HIGHLIGHTER_COLORS = ['#FFE14D', '#7EE081', '#FF8FC7', '#6EC6FF', '#FFB054'];
/** Highlighter widths in screen pixels, like `PEN_WIDTHS`. */
export const HIGHLIGHTER_WIDTHS = [12, 20, 32];

/** Distance from point p to segment a-b. */
function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker: drop points that deviate less than `tolerance`. */
export function simplify(points: Vec[], tolerance: number): Vec[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxD = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance(points[i], points[start], points[end]);
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (index !== -1 && maxD > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Smooth SVG path through points: quadratic curves via segment midpoints. */
export function smoothPath(points: Vec[]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  if (!points.length) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${f(p.x)} ${f(p.y)} L ${f(p.x)} ${f(p.y)}`;
  }
  if (points.length === 2) {
    return `M ${f(points[0].x)} ${f(points[0].y)} L ${f(points[1].x)} ${f(points[1].y)}`;
  }
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    d += ` Q ${f(p.x)} ${f(p.y)} ${f((p.x + next.x) / 2)} ${f((p.y + next.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return d + ` L ${f(last.x)} ${f(last.y)}`;
}

/** Decode an item's normalized points into its current box (local coordinates). */
export function pathPoints(it: Item): Vec[] {
  const pts = it.points ?? [];
  const out: Vec[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i] * it.w, y: pts[i + 1] * it.h });
  return out;
}

/**
 * Build a pen item from world-space points. The box hugs the stroke (including
 * its width) and the points are stored normalized to that box.
 */
export function makePathItem(world: Vec[], color: string, strokeWidth: number, highlight = false): Item {
  const pad = strokeWidth / 2;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of world) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  const x = x1 - pad;
  const y = y1 - pad;
  const w = Math.max(x2 - x1 + strokeWidth, 1);
  const h = Math.max(y2 - y1 + strokeWidth, 1);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const points = world.flatMap((p) => [round((p.x - x) / w), round((p.y - y) / h)]);
  return {
    id: uid(),
    type: 'path',
    x,
    y,
    w,
    h,
    fill: 'transparent',
    color,
    text: '',
    fontSize: 14,
    points,
    strokeWidth,
    ...(highlight ? { highlight: true } : {}),
  };
}

/** Eraser diameter range and default, in screen pixels at the current zoom. */
export const ERASER_MIN = 4;
export const ERASER_MAX = 80;
export const ERASER_DEFAULT = 24;

/** Points from a to b (both included), at most `step` apart. */
function sampleLine(a: Vec, b: Vec, step: number, out: Vec[], includeStart: boolean) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  for (let k = includeStart ? 0 : 1; k <= n; k++) {
    const t = k / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
}

/**
 * Points along the curve `smoothPath` draws through `pts`, roughly `step`
 * apart, so erasing follows what is on screen rather than the raw points.
 */
function sampleStroke(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  if (pts.length < 3) {
    if (pts.length === 1) out.push(pts[0]);
    else if (pts.length === 2) sampleLine(pts[0], pts[1], step, out, true);
    return out;
  }
  out.push(pts[0]);
  let start = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i];
    const end = { x: (c.x + pts[i + 1].x) / 2, y: (c.y + pts[i + 1].y) / 2 };
    const len = Math.hypot(c.x - start.x, c.y - start.y) + Math.hypot(end.x - c.x, end.y - c.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      out.push({
        x: u * u * start.x + 2 * u * t * c.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * c.y + t * t * end.y,
      });
    }
    start = end;
  }
  sampleLine(start, pts[pts.length - 1], step, out, false);
  return out;
}

/**
 * Erase the part of a pen stroke that an eraser swept from `a` to `b` covers
 * (world points; `radius` in world units). Returns `null` when the stroke is
 * untouched, otherwise the pieces left over (none if it was wiped out), as new
 * stroke items with the same color, width and highlight. `tolerance` is the
 * simplification tolerance for the pieces, in world units.
 */
export function eraseStroke(it: Item, a: Vec, b: Vec, radius: number, tolerance: number): Item[] | null {
  if (it.type !== 'path') return null;
  const width = it.strokeWidth ?? 3;
  const reach = radius + width / 2;
  // Quick reject: the swept segment must come near the stroke's box.
  if (
    Math.max(a.x, b.x) < it.x - reach ||
    Math.min(a.x, b.x) > it.x + it.w + reach ||
    Math.max(a.y, b.y) < it.y - reach ||
    Math.min(a.y, b.y) > it.y + it.h + reach
  ) {
    return null;
  }
  const world = pathPoints(it).map((p) => ({ x: p.x + it.x, y: p.y + it.y }));
  const samples = sampleStroke(world, Math.max(radius / 3, 0.05));
  const keep = samples.map((p) => segmentDistance(p, a, b) > reach);
  if (keep.every(Boolean)) return null;

  const pieces: Item[] = [];
  let run: Vec[] = [];
  const flush = () => {
    if (run.length >= 2) pieces.push(makePathItem(simplify(run, tolerance), it.color, width, !!it.highlight));
    run = [];
  };
  samples.forEach((p, i) => (keep[i] ? run.push(p) : flush()));
  flush();
  return pieces;
}
