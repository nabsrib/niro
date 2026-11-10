import type { Bend, Box, Connector, Endpoint, Item, Side, Vec } from './types';
import { boundsOf, containsPoint, uid } from './geometry';

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const NORMALS: Record<Side, Vec> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

type ItemMap = Record<string, Item | undefined>;

export const CONNECTOR_DEFAULTS: Omit<Connector, 'id' | 'from' | 'to'> = {
  style: 'curved',
  stroke: '#1A1A1A',
  strokeWidth: 2,
  startArrow: 'none',
  endArrow: 'arrow',
};

export function makeConnector(from: Endpoint, to: Endpoint): Connector {
  return { ...CONNECTOR_DEFAULTS, id: uid(), from, to };
}

// ---------- small vector helpers ----------

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec) => Math.hypot(a.x, a.y);
const norm = (a: Vec): Vec => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};
const fmt = (p: Vec) => `${round(p.x)} ${round(p.y)}`;
const round = (n: number) => Math.round(n * 100) / 100;

const center = (b: Box): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function sidePoint(b: Box, side: Side): Vec {
  switch (side) {
    case 'top':
      return { x: b.x + b.w / 2, y: b.y };
    case 'right':
      return { x: b.x + b.w, y: b.y + b.h / 2 };
    case 'bottom':
      return { x: b.x + b.w / 2, y: b.y + b.h };
    case 'left':
      return { x: b.x, y: b.y + b.h / 2 };
  }
}

/** Where a ray from the item center toward `target` leaves the item's outline. */
function boundaryToward(it: Item, target: Vec): { p: Vec; dir: Vec } {
  const c = center(it);
  const rx = Math.max(it.w / 2, 1e-6);
  const ry = Math.max(it.h / 2, 1e-6);
  let dx = target.x - c.x;
  let dy = target.y - c.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) dy = -1;
  const t =
    it.type === 'ellipse'
      ? 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
      : Math.min(rx / Math.abs(dx || 1e-9), ry / Math.abs(dy || 1e-9));
  const p = { x: c.x + dx * t, y: c.y + dy * t };
  // The outgoing direction is the normal of the side we exit through.
  const dir =
    Math.abs(dx) / rx >= Math.abs(dy) / ry ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  return { p, dir };
}

/** Point the opposite end aims at: an item center/side, or the free point. */
function aimPoint(e: Endpoint, items: ItemMap): Vec | null {
  if (e.kind === 'point') return { x: e.x, y: e.y };
  const it = items[e.itemId];
  if (!it) return null;
  return e.side ? sidePoint(it, e.side) : center(it);
}

function resolveEnd(e: Endpoint, other: Vec, items: ItemMap): { p: Vec; dir: Vec | null } | null {
  if (e.kind === 'point') return { p: { x: e.x, y: e.y }, dir: null };
  const it = items[e.itemId];
  if (!it) return null;
  if (e.side) return { p: sidePoint(it, e.side), dir: NORMALS[e.side] };
  return boundaryToward(it, other);
}

export interface Resolved {
  a: Vec;
  b: Vec;
  /** Outward direction at each end (null for free points). */
  da: Vec | null;
  db: Vec | null;
}

export function resolveConnector(c: Connector, items: ItemMap): Resolved | null {
  const aimA = aimPoint(c.from, items);
  const aimB = aimPoint(c.to, items);
  if (!aimA || !aimB) return null;
  const A = resolveEnd(c.from, aimB, items);
  const B = resolveEnd(c.to, aimA, items);
  if (!A || !B) return null;
  return { a: A.p, b: B.p, da: A.dir, db: B.dir };
}

// ---------- path construction ----------

const ELBOW_STUB = 30;

/** Does the axis-aligned segment p-q pass through the inside of box b? */
function segmentHitsBox(p: Vec, q: Vec, b: Box): boolean {
  const inset = 1;
  const x1 = b.x + inset, x2 = b.x + b.w - inset, y1 = b.y + inset, y2 = b.y + b.h - inset;
  const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
  return maxX > x1 && minX < x2 && maxY > y1 && minY < y2;
}

/**
 * Orthogonal route from a to b. Each attached end first steps out of its item
 * (a short stub along the side normal), then a few candidate routes between the
 * stubs are scored: shortest wins, with a heavy penalty for cutting through
 * either connected item or doubling back against a stub.
 */
function elbowPoints({ a, b, da, db }: Resolved, obstacles: Box[]): Vec[] {
  const a2 = da ? add(a, mul(da, ELBOW_STUB)) : a;
  const b2 = db ? add(b, mul(db, ELBOW_STUB)) : b;
  // Channels to route through: halfway between the ends, or just outside
  // everything involved (to go around the items).
  const all = boundsOf([...obstacles, { ...a2, w: 0, h: 0 }, { ...b2, w: 0, h: 0 }])!;
  const xs = [(a2.x + b2.x) / 2, all.x - ELBOW_STUB, all.x + all.w + ELBOW_STUB];
  const ys = [(a2.y + b2.y) / 2, all.y - ELBOW_STUB, all.y + all.h + ELBOW_STUB];
  const candidates: Vec[][] = [
    [{ x: b2.x, y: a2.y }],
    [{ x: a2.x, y: b2.y }],
    ...xs.map((x) => [{ x, y: a2.y }, { x, y: b2.y }]),
    ...ys.map((y) => [{ x: a2.x, y }, { x: b2.x, y }]),
  ];

  let best: Vec[] = [];
  let bestScore = Infinity;
  for (const mid of candidates) {
    const route = [a2, ...mid, b2];
    let score = 0;
    for (let i = 1; i < route.length; i++) {
      const p = route[i - 1];
      const q = route[i];
      score += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      for (const ob of obstacles) if (segmentHitsBox(p, q, ob)) score += 1e6;
    }
    // Leaving a stub backwards, or arriving at one from the wrong side, looks broken.
    const firstLeg = sub(route[1], route[0]);
    const lastLeg = sub(route[route.length - 1], route[route.length - 2]);
    if (da && firstLeg.x * da.x + firstLeg.y * da.y < -0.01) score += 1e4;
    if (db && lastLeg.x * db.x + lastLeg.y * db.y > 0.01) score += 1e4;
    if (score < bestScore) {
      bestScore = score;
      best = route;
    }
  }
  return simplify([a, ...best, b]);
}

function dedupe(pts: Vec[]): Vec[] {
  return pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1])) > 0.01);
}

/** Remove duplicate points and middle points of straight runs. */
function simplify(pts: Vec[]): Vec[] {
  const out = dedupe(pts);
  for (let i = out.length - 2; i > 0; i--) {
    const p = out[i - 1], q = out[i], r = out[i + 1];
    const collinear = (Math.abs(p.x - q.x) < 0.01 && Math.abs(q.x - r.x) < 0.01) ||
      (Math.abs(p.y - q.y) < 0.01 && Math.abs(q.y - r.y) < 0.01);
    if (collinear) out.splice(i, 1);
  }
  return out;
}

function roundedPolyline(pts: Vec[], radius: number): string {
  let d = `M ${fmt(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const r = Math.min(radius, len(sub(p1, p0)) / 2, len(sub(p2, p1)) / 2);
    const q1 = sub(p1, mul(norm(sub(p1, p0)), r));
    const q2 = add(p1, mul(norm(sub(p2, p1)), r));
    d += ` L ${fmt(q1)} Q ${fmt(p1)} ${fmt(q2)}`;
  }
  return d + ` L ${fmt(pts[pts.length - 1])}`;
}

function arrowHead(tip: Vec, dir: Vec, size: number): string {
  const base = sub(tip, mul(dir, size));
  const n = { x: -dir.y, y: dir.x };
  const p1 = add(base, mul(n, size * 0.5));
  const p2 = sub(base, mul(n, size * 0.5));
  return `M ${fmt(tip)} L ${fmt(p1)} L ${fmt(p2)} Z`;
}

const bezier = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

export interface ConnectorGeometry {
  a: Vec;
  b: Vec;
  d: string;
  startHead: string | null;
  endHead: string | null;
  /** Points along the path, for hit-testing and bounds. */
  samples: Vec[];
  bounds: Box;
  /** Middle of the path: where the curve handle sits. */
  mid: Vec;
}

/** World position of a bend for a connector running from `a` to `b`. */
export function bendPoint(a: Vec, b: Vec, bend: Bend): Vec {
  const chord = sub(b, a);
  const u = norm(chord);
  const n = { x: u.y, y: -u.x };
  const L = len(chord);
  return add(a, add(mul(u, bend.along * L), mul(n, bend.offset * L)));
}

/** Bend that makes the curve from `a` to `b` pass through world point `p`. */
export function bendFromPoint(a: Vec, b: Vec, p: Vec): Bend | null {
  const chord = sub(b, a);
  const L = len(chord);
  if (L < 1e-6) return null;
  const u = norm(chord);
  const n = { x: u.y, y: -u.x };
  const rel = sub(p, a);
  return {
    along: (rel.x * u.x + rel.y * u.y) / L,
    offset: (rel.x * n.x + rel.y * n.y) / L,
  };
}

export function connectorGeometry(c: Connector, items: ItemMap): ConnectorGeometry | null {
  const r = resolveConnector(c, items);
  if (!r) return null;
  const { a, b } = r;
  const head = 8 + c.strokeWidth * 2;
  // Pull the stroke back under the arrowhead so it does not poke past the tip.
  const trim = head * 0.7;
  let d: string;
  let tanA: Vec; // direction of travel leaving `a`
  let tanB: Vec; // direction of travel arriving at `b`
  let samples: Vec[];
  let mid: Vec;

  const sampleCurve = (p0: Vec, p1: Vec, p2: Vec, p3: Vec) =>
    Array.from({ length: 13 }, (_, i) => bezier(p0, p1, p2, p3, i / 12));

  if (c.style === 'curved' && c.bend && len(sub(b, a)) > 1e-6) {
    // Two cubic segments that meet smoothly at the bend point P; the tangent
    // at P runs parallel to the line between the ends.
    const P = bendPoint(a, b, c.bend);
    const l1 = Math.max(len(sub(P, a)), 1);
    const l2 = Math.max(len(sub(b, P)), 1);
    const da = r.da ?? norm(sub(P, a));
    const db = r.db ?? norm(sub(P, b));
    const tP = norm(sub(b, a));
    const c1 = add(a, mul(da, l1 * 0.5));
    const c2 = sub(P, mul(tP, l1 * 0.4));
    const c3 = add(P, mul(tP, l2 * 0.4));
    const c4 = add(b, mul(db, l2 * 0.5));
    tanA = norm(sub(c1, a));
    tanB = norm(sub(b, c4));
    const a2 = c.startArrow === 'arrow' ? add(a, mul(tanA, trim)) : a;
    const b2 = c.endArrow === 'arrow' ? sub(b, mul(tanB, trim)) : b;
    d = `M ${fmt(a2)} C ${fmt(c1)} ${fmt(c2)} ${fmt(P)} C ${fmt(c3)} ${fmt(c4)} ${fmt(b2)}`;
    samples = [...sampleCurve(a, c1, c2, P), ...sampleCurve(P, c3, c4, b).slice(1)];
    mid = P;
  } else if (c.style === 'curved') {
    const k = Math.max(30, len(sub(b, a)) * 0.4);
    const da = r.da ?? norm(sub(b, a));
    const db = r.db ?? norm(sub(a, b));
    const c1 = add(a, mul(da, k));
    const c2 = add(b, mul(db, k));
    tanA = norm(sub(c1, a));
    tanB = norm(sub(b, c2));
    const a2 = c.startArrow === 'arrow' ? add(a, mul(tanA, trim)) : a;
    const b2 = c.endArrow === 'arrow' ? sub(b, mul(tanB, trim)) : b;
    d = `M ${fmt(a2)} C ${fmt(c1)} ${fmt(c2)} ${fmt(b2)}`;
    samples = sampleCurve(a, c1, c2, b);
    mid = bezier(a, c1, c2, b, 0.5);
  } else {
    const obstacles = [endpointItem(c.from), endpointItem(c.to)]
      .map((id) => (id ? items[id] : undefined))
      .filter((it): it is Item => !!it);
    const pts = dedupe(c.style === 'elbow' ? elbowPoints(r, obstacles) : [a, b]);
    if (pts.length < 2) pts.push({ x: a.x + 0.01, y: a.y });
    tanA = norm(sub(pts[1], pts[0]));
    tanB = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
    samples = pts.flatMap((p, i) => (i === 0 ? [p] : [mul(add(p, pts[i - 1]), 0.5), p]));
    mid = samples[Math.floor(samples.length / 2)];
    const trimmed = pts.slice();
    const last = trimmed.length - 1;
    if (c.endArrow === 'arrow') {
      const seg = len(sub(trimmed[last], trimmed[last - 1]));
      trimmed[last] = sub(trimmed[last], mul(tanB, Math.min(trim, seg)));
    }
    if (c.startArrow === 'arrow') {
      const seg = len(sub(trimmed[1], trimmed[0]));
      trimmed[0] = add(trimmed[0], mul(tanA, Math.min(trim, seg)));
    }
    d = roundedPolyline(trimmed, 12);
  }

  return {
    a,
    b,
    d,
    startHead: c.startArrow === 'arrow' ? arrowHead(a, mul(tanA, -1), head) : null,
    endHead: c.endArrow === 'arrow' ? arrowHead(b, tanB, head) : null,
    samples,
    bounds: boundsOf(samples.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!,
    mid,
  };
}

// ---------- attaching ----------

/** Topmost item under `p` (with `pad` world units of slack), ignoring `exclude`. */
export function itemAt(
  p: Vec,
  items: ItemMap,
  order: string[],
  pad: number,
  exclude?: string,
): Item | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const it = items[order[i]];
    // Frames (containers) and pen strokes are not connection targets.
    if (!it || it.id === exclude || it.type === 'frame' || it.type === 'path') continue;
    if (containsPoint({ x: it.x - pad, y: it.y - pad, w: it.w + pad * 2, h: it.h + pad * 2 }, p)) return it;
  }
  return null;
}

/** The side whose midpoint is within `tol` of `p`, if any. */
export function snapSide(it: Box, p: Vec, tol: number): Side | null {
  let best: Side | null = null;
  let bestD = tol;
  for (const s of SIDES) {
    const d = len(sub(sidePoint(it, s), p));
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Endpoint for a pointer at world point `p`: attached if over an item, else free. */
export function endpointAt(
  p: Vec,
  items: ItemMap,
  order: string[],
  zoom: number,
  exclude?: string,
): Endpoint {
  const it = itemAt(p, items, order, 8 / zoom, exclude);
  if (!it) return { kind: 'point', x: p.x, y: p.y };
  return { kind: 'item', itemId: it.id, side: snapSide(it, p, 16 / zoom) };
}

export const endpointItem = (e: Endpoint) => (e.kind === 'item' ? e.itemId : undefined);
