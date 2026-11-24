import type { ArrowHead, Bend, Box, Connector, ElbowChannel, Endpoint, Item, LineDash, Side, Vec } from './types';
import { boundsOf, containsPoint, uid } from './geometry';
import { polygonExit, shapeOf } from './shapes';

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
  // Polygon shapes (triangle, diamond, star…): meet their outline, not the box.
  const exit = polygonExit(shapeOf(it), it.w, it.h, { x: target.x - it.x, y: target.y - it.y });
  const p = exit ? { x: it.x + exit.x, y: it.y + exit.y } : { x: c.x + dx * t, y: c.y + dy * t };
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
  if (e.side) {
    // On a polygon shape the side point is where the outline crosses toward that side's midpoint.
    const mid = sidePoint(it, e.side);
    const exit = polygonExit(shapeOf(it), it.w, it.h, { x: mid.x - it.x, y: mid.y - it.y });
    return { p: exit ? { x: it.x + exit.x, y: it.y + exit.y } : mid, dir: NORMALS[e.side] };
  }
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
function elbowPoints(r: Resolved, obstacles: Box[], channel: ElbowChannel | null): ElbowRoute {
  const { a, b, da, db } = r;
  const a2 = da ? add(a, mul(da, ELBOW_STUB)) : a;
  const b2 = db ? add(b, mul(db, ELBOW_STUB)) : b;
  const baseOf = (axis: 'x' | 'y') => (axis === 'x' ? (a2.x + b2.x) / 2 : (a2.y + b2.y) / 2);

  // A hand-placed middle segment: out of the start stub, along the channel, into the end stub.
  if (channel) {
    const base = baseOf(channel.axis);
    const v = base + channel.offset;
    const mid = channel.axis === 'x' ? [{ x: v, y: a2.y }, { x: v, y: b2.y }] : [{ x: a2.x, y: v }, { x: b2.x, y: v }];
    return {
      pts: simplify([a, a2, ...mid, b2, b]),
      handle: { p: mul(add(mid[0], mid[1]), 0.5), axis: channel.axis, base },
    };
  }
  const pts = autoElbow(a, b, a2, b2, da, db, obstacles);
  // Handle on the longest middle segment (not the stubs), which becomes the channel when dragged.
  let best = -1;
  let bestLen = -1;
  const inner = pts.length > 3;
  for (let i = inner ? 1 : 0; i < pts.length - (inner ? 2 : 1); i++) {
    const l = len(sub(pts[i + 1], pts[i]));
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  if (best < 0) return { pts, handle: null };
  const p = pts[best];
  const q = pts[best + 1];
  const axis = Math.abs(p.x - q.x) < 0.01 ? 'x' : 'y';
  return { pts, handle: { p: mul(add(p, q), 0.5), axis, base: baseOf(axis) } };
}

interface ElbowRoute {
  pts: Vec[];
  handle: ChannelHandle | null;
}

/** The movable middle segment of an elbow line: where its handle sits and how its offset is measured. */
export interface ChannelHandle {
  p: Vec;
  axis: 'x' | 'y';
  /** Coordinate (on `axis`) of the point halfway between the ends; the channel's offset is measured from it. */
  base: number;
}

/** Automatic orthogonal route (see elbowPoints). */
function autoElbow(a: Vec, b: Vec, a2: Vec, b2: Vec, da: Vec | null, db: Vec | null, obstacles: Box[]): Vec[] {
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

/**
 * An end shape: its outline, and whether it is filled with the line color (else
 * drawn as a line). `hollow`: extra outline filled white (the "zero" ring of a
 * crow's-foot end), drawn over the line.
 */
export interface HeadShape {
  d: string;
  fill: boolean;
  hollow?: string;
}

/** How far (as a fraction of the head size) the line stops short of the tip, so it ends under the head. */
const HEAD_TRIM: Record<ArrowHead, number> = {
  none: 0,
  arrow: 0.7,
  open: 0.1,
  circle: 0.8,
  diamond: 0.95,
  bar: 0,
  // Hollow shapes: the line stops at their back so it doesn't show through.
  triangle: 1.1,
  hollowDiamond: 1.2,
  one: 0,
  zeroOne: 0,
  many: 0,
  oneMany: 0,
  zeroMany: 0,
};

function headShape(kind: ArrowHead, tip: Vec, dir: Vec, size: number): HeadShape | null {
  const n = { x: -dir.y, y: dir.x };
  // Crow's-foot pieces, measured back from the tip (where the line meets the item).
  const s = size * 1.1;
  const bar = (at: number) => {
    const p = sub(tip, mul(dir, at));
    return `M ${fmt(add(p, mul(n, s * 0.55)))} L ${fmt(sub(p, mul(n, s * 0.55)))}`;
  };
  const crow = `M ${fmt(add(tip, mul(n, s * 0.6)))} L ${fmt(sub(tip, mul(dir, s)))} L ${fmt(sub(tip, mul(n, s * 0.6)))}`;
  const ring = (at: number) => {
    const c = sub(tip, mul(dir, at));
    const r = s * 0.3;
    return `M ${round(c.x + r)} ${round(c.y)} A ${round(r)} ${round(r)} 0 1 0 ${round(c.x - r)} ${round(c.y)} A ${round(r)} ${round(r)} 0 1 0 ${round(c.x + r)} ${round(c.y)} Z`;
  };
  switch (kind) {
    case 'triangle': {
      const base = sub(tip, mul(dir, size * 1.1));
      return { d: `M ${fmt(tip)} L ${fmt(add(base, mul(n, size * 0.6)))} L ${fmt(sub(base, mul(n, size * 0.6)))} Z`, fill: false };
    }
    case 'hollowDiamond': {
      const m = sub(tip, mul(dir, size * 0.6));
      const back = sub(tip, mul(dir, size * 1.2));
      return {
        d: `M ${fmt(tip)} L ${fmt(add(m, mul(n, size * 0.4)))} L ${fmt(back)} L ${fmt(sub(m, mul(n, size * 0.4)))} Z`,
        fill: false,
      };
    }
    case 'one':
      return { d: `${bar(s * 0.45)} ${bar(s * 0.8)}`, fill: false };
    case 'zeroOne':
      return { d: bar(s * 0.45), fill: false, hollow: ring(s * 1.05) };
    case 'many':
      return { d: crow, fill: false };
    case 'oneMany':
      return { d: `${crow} ${bar(s * 1.3)}`, fill: false };
    case 'zeroMany':
      return { d: crow, fill: false, hollow: ring(s * 1.45) };
    case 'arrow': {
      const base = sub(tip, mul(dir, size));
      return { d: `M ${fmt(tip)} L ${fmt(add(base, mul(n, size * 0.5)))} L ${fmt(sub(base, mul(n, size * 0.5)))} Z`, fill: true };
    }
    case 'open': {
      const base = sub(tip, mul(dir, size * 0.9));
      return { d: `M ${fmt(add(base, mul(n, size * 0.5)))} L ${fmt(tip)} L ${fmt(sub(base, mul(n, size * 0.5)))}`, fill: false };
    }
    case 'circle': {
      const r = size * 0.4;
      const c = sub(tip, mul(dir, r));
      return {
        d: `M ${round(c.x + r)} ${round(c.y)} A ${round(r)} ${round(r)} 0 1 0 ${round(c.x - r)} ${round(c.y)} A ${round(r)} ${round(r)} 0 1 0 ${round(c.x + r)} ${round(c.y)} Z`,
        fill: true,
      };
    }
    case 'diamond': {
      const m = sub(tip, mul(dir, size * 0.5));
      const back = sub(tip, mul(dir, size));
      return {
        d: `M ${fmt(tip)} L ${fmt(add(m, mul(n, size * 0.35)))} L ${fmt(back)} L ${fmt(sub(m, mul(n, size * 0.35)))} Z`,
        fill: true,
      };
    }
    case 'bar':
      return { d: `M ${fmt(add(tip, mul(n, size * 0.5)))} L ${fmt(sub(tip, mul(n, size * 0.5)))}`, fill: false };
    default:
      return null;
  }
}

/** SVG stroke-dasharray for a line pattern at this stroke width (undefined = solid). */
export function dashArray(dash: LineDash | null | undefined, width: number): string | undefined {
  if (dash === 'dashed') return `${round(width * 4)} ${round(width * 3)}`;
  if (dash === 'dotted') return `0 ${round(width * 2.2)}`;
  return undefined;
}

/** A connector's bend points (older saves keep a single curve bend in `bend`). */
export function bendsOf(c: Connector): Bend[] {
  if (c.bends && c.bends.length) return c.bends;
  return c.style === 'curved' && c.bend ? [c.bend] : [];
}

const bezier = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

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

export interface ConnectorGeometry {
  a: Vec;
  b: Vec;
  d: string;
  startHead: HeadShape | null;
  endHead: HeadShape | null;
  /** Points along the path, for hit-testing and bounds. */
  samples: Vec[];
  bounds: Box;
  /** Middle of the path. */
  mid: Vec;
  /** Bend points in world space, in order (straight and curved lines), for their handles. */
  bendPoints: Vec[];
  /** Spots between neighbouring points where dragging adds a bend (`index`: where it goes in `bends`). */
  addPoints: { index: number; p: Vec }[];
  /** Elbow lines: the handle of the movable middle segment. */
  channel: ChannelHandle | null;
}

export function connectorGeometry(c: Connector, items: ItemMap): ConnectorGeometry | null {
  const r0 = resolveConnector(c, items);
  if (!r0) return null;
  // Bend points are placed relative to the straight line between the ends as
  // resolved toward each other (the same line `bendFromPoint` measures against).
  const bends = c.style === 'elbow' || len(sub(r0.b, r0.a)) < 1e-6 ? [] : bendsOf(c);
  const P = bends.map((bd) => bendPoint(r0.a, r0.b, bd));
  // A floating end then aims at its nearest bend point instead of the far end.
  let r = r0;
  if (P.length) {
    const A = c.from.kind === 'item' && !c.from.side ? resolveEnd(c.from, P[0], items) : null;
    const B = c.to.kind === 'item' && !c.to.side ? resolveEnd(c.to, P[P.length - 1], items) : null;
    r = { a: A?.p ?? r0.a, da: A ? A.dir : r0.da, b: B?.p ?? r0.b, db: B ? B.dir : r0.db };
  }
  const { a, b } = r;
  const head = 8 + c.strokeWidth * 2;
  // Pull the stroke back under the end shapes so it does not poke past them.
  // (An end shape this version doesn't know, from a newer client, trims nothing.)
  const trimA = head * (HEAD_TRIM[c.startArrow] ?? 0);
  const trimB = head * (HEAD_TRIM[c.endArrow] ?? 0);
  let d: string;
  let tanA: Vec; // direction of travel leaving `a`
  let tanB: Vec; // direction of travel arriving at `b`
  let samples: Vec[];
  let addPoints: { index: number; p: Vec }[] = [];
  let channel: ChannelHandle | null = null;

  const sampleCurve = (p0: Vec, p1: Vec, p2: Vec, p3: Vec) =>
    Array.from({ length: 13 }, (_, i) => bezier(p0, p1, p2, p3, i / 12));

  if (c.style === 'curved' && P.length) {
    // A smooth curve through every bend point: one cubic segment per gap. At a
    // bend the curve runs parallel to the line between its neighbours; at the
    // ends it leaves along the side normal (or toward the first bend).
    const Q = [a, ...P, b];
    const last = Q.length - 1;
    const T = Q.map((q, i) => {
      if (i === 0) return r.da ?? norm(sub(Q[1], q));
      if (i === last) return r.db ? mul(r.db, -1) : norm(sub(q, Q[last - 1]));
      return norm(sub(Q[i + 1], Q[i - 1]));
    });
    const segs = Q.slice(0, last).map((q, i) => {
      const l = Math.max(len(sub(Q[i + 1], q)), 1);
      const c1 = add(q, mul(T[i], l * (i === 0 ? 0.5 : 0.4)));
      const c2 = sub(Q[i + 1], mul(T[i + 1], l * (i + 1 === last ? 0.5 : 0.4)));
      return { p0: q, c1, c2, p3: Q[i + 1] };
    });
    tanA = norm(sub(segs[0].c1, a));
    tanB = norm(sub(b, segs[segs.length - 1].c2));
    const a2 = add(a, mul(tanA, trimA));
    const b2 = sub(b, mul(tanB, trimB));
    d = `M ${fmt(a2)}` + segs.map((s, i) => ` C ${fmt(s.c1)} ${fmt(s.c2)} ${fmt(i === segs.length - 1 ? b2 : s.p3)}`).join('');
    samples = segs.flatMap((s, i) => sampleCurve(s.p0, s.c1, s.c2, s.p3).slice(i === 0 ? 0 : 1));
    addPoints = segs.map((s, i) => ({ index: i, p: bezier(s.p0, s.c1, s.c2, s.p3, 0.5) }));
  } else if (c.style === 'curved') {
    const k = Math.max(30, len(sub(b, a)) * 0.4);
    const da = r.da ?? norm(sub(b, a));
    const db = r.db ?? norm(sub(a, b));
    const c1 = add(a, mul(da, k));
    const c2 = add(b, mul(db, k));
    tanA = norm(sub(c1, a));
    tanB = norm(sub(b, c2));
    const a2 = add(a, mul(tanA, trimA));
    const b2 = sub(b, mul(tanB, trimB));
    d = `M ${fmt(a2)} C ${fmt(c1)} ${fmt(c2)} ${fmt(b2)}`;
    samples = sampleCurve(a, c1, c2, b);
    addPoints = [{ index: 0, p: bezier(a, c1, c2, b, 0.5) }];
  } else {
    let pts: Vec[];
    if (c.style === 'elbow') {
      const obstacles = [endpointItem(c.from), endpointItem(c.to)]
        .map((id) => (id ? items[id] : undefined))
        .filter((it): it is Item => !!it);
      const route = elbowPoints(r, obstacles, c.channel ?? null);
      pts = dedupe(route.pts);
      channel = route.handle;
    } else {
      const Q = [a, ...P, b];
      pts = dedupe(Q);
      addPoints = Q.slice(0, -1).map((q, i) => ({ index: i, p: mul(add(q, Q[i + 1]), 0.5) }));
    }
    if (pts.length < 2) pts.push({ x: a.x + 0.01, y: a.y });
    tanA = norm(sub(pts[1], pts[0]));
    tanB = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
    samples = pts.flatMap((p, i) => (i === 0 ? [p] : [mul(add(p, pts[i - 1]), 0.5), p]));
    const trimmed = pts.slice();
    const lastI = trimmed.length - 1;
    if (trimB) trimmed[lastI] = sub(trimmed[lastI], mul(tanB, Math.min(trimB, len(sub(trimmed[lastI], trimmed[lastI - 1])))));
    if (trimA) trimmed[0] = add(trimmed[0], mul(tanA, Math.min(trimA, len(sub(trimmed[1], trimmed[0])))));
    // Elbow corners are rounded; corners at bend points stay sharp, like Miro.
    d = roundedPolyline(trimmed, c.style === 'elbow' ? 12 : 0);
  }

  return {
    a,
    b,
    d,
    startHead: headShape(c.startArrow, a, mul(tanA, -1), head),
    endHead: headShape(c.endArrow, b, tanB, head),
    samples,
    bounds: boundsOf(samples.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!,
    mid: samples[Math.floor(samples.length / 2)],
    bendPoints: P,
    addPoints,
    channel,
  };
}

// ---------- labels ----------

export const LABEL_DEFAULTS = { size: 18, color: '#1A1A1A' };
/** Font sizes offered for connector labels. */
export const LABEL_SIZES = [12, 14, 18, 24, 32, 48, 64, 96];
export const LABEL_COLORS = ['#1A1A1A', '#6B6B76', '#E5383B', '#F28C28', '#2BA84A', '#2F6FED', '#8E44D9', '#FFFFFF'];

/** A small label near one end of a line (UML multiplicity like `1`, `*`, `0..1`). */
export interface EndLabel {
  key: 'start' | 'end';
  text: string;
  /** Centre of the text. */
  p: Vec;
  size: number;
}

/**
 * Where a line's end labels sit: a little way in from each end, beside the
 * line (clear of the end shape), at the line's label size (drawn semi-bold).
 */
export function endLabels(g: Pick<ConnectorGeometry, 'a' | 'b' | 'samples'>, c: Connector): EndLabel[] {
  const out: EndLabel[] = [];
  const S = g.samples;
  if (S.length < 2) return out;
  const size = Math.round(c.labelSize ?? LABEL_DEFAULTS.size);
  const head = 8 + c.strokeWidth * 2;
  const place = (key: EndLabel['key'], text: string, tip: Vec, inward: Vec) => {
    const n = { x: -inward.y, y: inward.x };
    const p = add(add(tip, mul(inward, head * 1.6 + size * 0.6)), mul(n, size * 0.9));
    out.push({ key, text, p, size });
  };
  if (c.startLabel) place('start', c.startLabel, g.a, norm(sub(S[1], S[0])));
  if (c.endLabel) place('end', c.endLabel, g.b, norm(sub(S[S.length - 2], S[S.length - 1])));
  return out;
}

/** Point `t` (0..1) of the way along a polyline, measured by length. */
export function pointAlong(pts: Vec[], t: number): Vec {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += len(sub(pts[i], pts[i - 1]));
  let left = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = len(sub(pts[i], pts[i - 1]));
    if (left <= seg && seg > 0) {
      const k = left / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k };
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

/** Fraction (0..1) of the way along a polyline, by length, of its point closest to `p`. */
export function fractionAlong(pts: Vec[], p: Vec): number {
  if (pts.length < 2) return 0.5;
  let total = 0;
  let best = Infinity;
  let bestAt = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const d = sub(pts[i], a);
    const seg = len(d);
    const k = seg > 0 ? Math.min(Math.max(((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (seg * seg), 0), 1) : 0;
    const dist = len(sub(p, { x: a.x + d.x * k, y: a.y + d.y * k }));
    if (dist < best) {
      best = dist;
      bestAt = total + seg * k;
    }
    total += seg;
  }
  return total > 0 ? bestAt / total : 0.5;
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
