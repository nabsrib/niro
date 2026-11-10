import type { Item, Vec } from './types';
import { uid } from './geometry';

export const PEN_COLORS = ['#1A1A1A', '#E5383B', '#F28C28', '#2BA84A', '#2F6FED', '#8E44D9'];
/** Pen widths in screen pixels at the zoom level the stroke is drawn at. */
export const PEN_WIDTHS = [2, 4, 8];

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
export function makePathItem(world: Vec[], color: string, strokeWidth: number): Item {
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
  };
}
