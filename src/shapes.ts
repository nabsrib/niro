import type { Item, LineDash, ShapeKind, Vec } from './types';
import { textOn } from './colors';

/**
 * Shape outlines for rectangle items (`item.shape`; absent = plain rectangle).
 * Pure: everything is in the item's own box (0..w, 0..h). The board, image
 * export and connectors all draw / aim at the same outline.
 */

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'round', label: 'Rounded rectangle' },
  { kind: 'pill', label: 'Pill (start / end)' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'star', label: 'Star' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'cylinder', label: 'Cylinder' },
  { kind: 'document', label: 'Document' },
  { kind: 'bubble', label: 'Speech bubble' },
  { kind: 'class', label: 'UML class (sections split by a "--" line)' },
  { kind: 'entity', label: 'Database table (first line is the name)' },
  { kind: 'actor', label: 'Actor (use case)' },
];

/** What a new shape starts with when placed (text, color, text size); others start empty. */
export const SHAPE_START: Partial<Record<ShapeKind, Partial<Item>>> = {
  class: { text: 'ClassName\n--\n- name: string\n--\n+ save(): void', fill: '#FFFFFF', fontSize: 16 },
  entity: { text: 'table_name\nid  PK\nname\nowner_id  FK', fill: '#A6CCF5', fontSize: 16 },
  actor: { text: 'Actor', fontSize: 16 },
};

/** Text color of a class / table row: a chosen text color, else readable on what is behind it. */
export function compartmentColor(it: Item, header: boolean): string {
  if (it.textColor) return it.textColor;
  // A table's rows sit on white; its header and a whole class box on the item's color.
  return shapeOf(it) === 'entity' && !header ? '#1a1a1a' : textOn(it.fill);
}

/** Shapes whose text is laid out in sections with lines between them (UML class, database table). */
export const isCompartmentShape = (kind: ShapeKind) => kind === 'class' || kind === 'entity';

export interface CompartmentLine {
  text: string;
  /** Top of the line, from the item's top. */
  y: number;
  /** The first section (class name, table name): bold and centred. */
  header: boolean;
}

export interface CompartmentLayout {
  /** Text size used: the item's, or smaller so every row fits the box. */
  fontSize: number;
  lines: CompartmentLine[];
  /** Divider lines, from the item's top. */
  dividers: number[];
  /** Height of the first section (a table's coloured header band). */
  headerH: number;
  lineH: number;
  /** Room left and right of the text. */
  padX: number;
  /** Height all rows need, borders included (at `fontSize`). */
  height: number;
}

/** A line made of two or more dashes (or a long dash) starts a new section; text after it is the section's first row. */
const SECTION_MARK = /^\s*(?:[-‐‑‒–—―]{2,}|[–—―])\s*(.*)$/;

/**
 * Split text lines into sections: at a `--` line (text after the dashes starts
 * the new section), or at an empty line (several empty lines count once; empty
 * lines at the end are ignored). `--` lines in a row make empty sections.
 */
function splitSections(lines: string[]): string[][] {
  const out: string[][] = [[]];
  let blankBreak = false; // the last section was started by an empty line
  for (const l of lines) {
    const m = SECTION_MARK.exec(l);
    if (m) {
      if (blankBreak) out[out.length - 1] = [];
      else out.push([]);
      blankBreak = false;
      if (m[1]) out[out.length - 1].push(m[1]);
    } else if (!l.replace(/[\s ​]/g, '')) {
      if (!blankBreak && out[out.length - 1].length) {
        out.push([]);
        blankBreak = true;
      }
    } else {
      out[out.length - 1].push(l);
      blankBreak = false;
    }
  }
  if (blankBreak) out.pop();
  return out;
}

/** Rough width of a row in ems (Inter averages a little over half an em per character). */
const rowEms = (t: string, header: boolean) => t.length * (header ? 0.62 : 0.58);

/**
 * Text of a class box or a database table split into sections, one text line
 * per row (no wrapping). A class splits at `--` lines or empty lines; a table's
 * first line is its name and the rest its columns. The text uses the item's
 * size, made smaller when needed so all rows fit the box (`box`). Used by the
 * board and export.
 */
export function compartmentLayout(
  kind: ShapeKind,
  text: string,
  fontSize: number,
  border: number,
  box?: { w: number; h: number },
): CompartmentLayout {
  const raw = text.split('\n');
  const sections =
    kind === 'entity' ? [[raw[0] ?? ''], ...(raw.length > 1 ? splitSections(raw.slice(1)) : [[]])] : splitSections(raw);
  if (box) {
    // Height and width per unit of text size, to shrink the text until it fits.
    const perUnit = sections.reduce((sum, sec) => sum + 0.7 + (sec.length ? sec.length * 1.35 : 0.81), 0);
    const widest = Math.max(1, ...sections.flatMap((sec, i) => sec.map((t) => rowEms(t, i === 0) + 1.2)));
    const fit = Math.min((box.h - border * 2) / perUnit, (box.w - border * 2) / widest);
    fontSize = Math.max(Math.min(fontSize, fit), 4);
  }
  const lineH = fontSize * 1.35;
  const padY = fontSize * 0.35;
  const lines: CompartmentLine[] = [];
  const dividers: number[] = [];
  let y = border;
  let headerH = 0;
  sections.forEach((sec, i) => {
    if (i > 0) dividers.push(y);
    y += padY;
    // An empty section still shows as a short band.
    if (!sec.length) y += lineH * 0.6;
    for (const t of sec) {
      lines.push({ text: t, y, header: i === 0 });
      y += lineH;
    }
    y += padY;
    if (i === 0) headerH = y;
  });
  return { fontSize, lines, dividers, headerH, lineH, padX: fontSize * 0.6 + border, height: y + border };
}
export const SHAPE_KINDS = SHAPES.map((s) => s.kind);

/** The shape of an item (rectangles only; others count as plain boxes). */
export const shapeOf = (it: Pick<Item, 'type' | 'shape'>): ShapeKind => (it.type === 'rect' && it.shape ? it.shape : 'rect');

/** Default border: dark, 2 units wide (ellipses and rectangles). */
export const BORDER_DEFAULTS = { color: '#1A1A1A', width: 2 };
export const BORDER_WIDTHS = [0, 1, 2, 4, 8];
export const BORDER_COLORS = ['#1A1A1A', '#6B6B76', '#C4C4CC', '#E5383B', '#F28C28', '#2BA84A', '#2F6FED', '#8E44D9', '#FFFFFF'];

export const borderColor = (it: Item) => it.border ?? BORDER_DEFAULTS.color;
export const borderWidth = (it: Item) => it.borderWidth ?? BORDER_DEFAULTS.width;
export const borderDash = (it: Item): LineDash | null => it.borderDash ?? null;

const r = (n: number) => Math.round(n * 100) / 100;
const pathOf = (pts: Vec[]) => `M ${pts.map((p) => `${r(p.x)} ${r(p.y)}`).join(' L ')} Z`;

/** Corner points for shapes that are polygons (null for rectangles, ellipse-like and curved shapes). */
export function shapePolygon(kind: ShapeKind, w: number, h: number): Vec[] | null {
  switch (kind) {
    case 'triangle':
      return [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    case 'diamond':
      return [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }];
    case 'parallelogram':
      return [{ x: w * 0.2, y: 0 }, { x: w, y: 0 }, { x: w * 0.8, y: h }, { x: 0, y: h }];
    case 'hexagon':
      return [
        { x: w * 0.25, y: 0 },
        { x: w * 0.75, y: 0 },
        { x: w, y: h / 2 },
        { x: w * 0.75, y: h },
        { x: w * 0.25, y: h },
        { x: 0, y: h / 2 },
      ];
    case 'star': {
      const pts: Vec[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.45 : 1;
        pts.push({ x: w / 2 + Math.cos(a) * (w / 2) * k, y: h / 2 + Math.sin(a) * (h / 2) * k });
      }
      return pts;
    }
    case 'arrow':
      return [
        { x: 0, y: h * 0.25 },
        { x: w * 0.6, y: h * 0.25 },
        { x: w * 0.6, y: 0 },
        { x: w, y: h / 2 },
        { x: w * 0.6, y: h },
        { x: w * 0.6, y: h * 0.75 },
        { x: 0, y: h * 0.75 },
      ];
    default:
      return null;
  }
}

/**
 * SVG path of a shape filling a w×h box, inset by `inset` on every side (half
 * the border width, so the border stays inside the item's box).
 */
export function shapePath(kind: ShapeKind, w: number, h: number, inset = 0): string {
  const W = Math.max(w - inset * 2, 1);
  const H = Math.max(h - inset * 2, 1);
  const o = inset;
  const poly = shapePolygon(kind, W, H);
  if (poly) return pathOf(poly.map((p) => ({ x: p.x + o, y: p.y + o })));
  switch (kind) {
    case 'round': {
      const rr = Math.min(W, H) * 0.18;
      return (
        `M ${r(o + rr)} ${r(o)} H ${r(o + W - rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + W)} ${r(o + rr)} ` +
        `V ${r(o + H - rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + W - rr)} ${r(o + H)} H ${r(o + rr)} ` +
        `A ${r(rr)} ${r(rr)} 0 0 1 ${r(o)} ${r(o + H - rr)} V ${r(o + rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + rr)} ${r(o)} Z`
      );
    }
    case 'pill': {
      // Fully rounded ends: the flowchart start / end shape.
      const rr = Math.min(W, H) / 2;
      return (
        `M ${r(o + rr)} ${r(o)} H ${r(o + W - rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + W - rr)} ${r(o + H)} ` +
        `H ${r(o + rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + rr)} ${r(o)} Z`
      );
    }
    case 'document': {
      // A sheet with a wavy bottom edge: up on the right half, down on the left.
      const a = H * 0.1;
      return (
        `M ${r(o)} ${r(o)} H ${r(o + W)} V ${r(o + H - a)} ` +
        `Q ${r(o + W * 0.75)} ${r(o + H - a * 3)} ${r(o + W / 2)} ${r(o + H - a)} T ${r(o)} ${r(o + H - a)} Z`
      );
    }
    case 'actor': {
      // Stick figure in the top three quarters; the name goes underneath (textInset).
      // Every line is its own two-point subpath, so filling only fills the head.
      const cx = o + W / 2;
      const hr = Math.min(W * 0.16, H * 0.09);
      const hy = o + hr;
      const neck = o + hr * 2;
      const hip = o + H * 0.48;
      const arms = o + H * 0.28;
      const feet = o + H * 0.7;
      return (
        `M ${r(cx + hr)} ${r(hy)} A ${r(hr)} ${r(hr)} 0 1 0 ${r(cx - hr)} ${r(hy)} A ${r(hr)} ${r(hr)} 0 1 0 ${r(cx + hr)} ${r(hy)} Z ` +
        `M ${r(cx)} ${r(neck)} L ${r(cx)} ${r(hip)} M ${r(o + W * 0.15)} ${r(arms)} L ${r(o + W * 0.85)} ${r(arms)} ` +
        `M ${r(cx)} ${r(hip)} L ${r(o + W * 0.2)} ${r(feet)} M ${r(cx)} ${r(hip)} L ${r(o + W * 0.8)} ${r(feet)}`
      );
    }
    case 'cylinder': {
      // Body with a curved bottom, plus the top ellipse drawn in full.
      const ry = Math.min(H * 0.15, W * 0.25);
      return (
        `M ${r(o)} ${r(o + ry)} V ${r(o + H - ry)} A ${r(W / 2)} ${r(ry)} 0 0 0 ${r(o + W)} ${r(o + H - ry)} V ${r(o + ry)} ` +
        `A ${r(W / 2)} ${r(ry)} 0 0 0 ${r(o)} ${r(o + ry)} A ${r(W / 2)} ${r(ry)} 0 0 0 ${r(o + W)} ${r(o + ry)}`
      );
    }
    case 'bubble': {
      // Rounded body on the top 80%, with a tail at the bottom left.
      const bh = H * 0.8;
      const rr = Math.min(W, bh) * 0.15;
      return (
        `M ${r(o + rr)} ${r(o)} H ${r(o + W - rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + W)} ${r(o + rr)} ` +
        `V ${r(o + bh - rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + W - rr)} ${r(o + bh)} H ${r(o + W * 0.35)} ` +
        `L ${r(o + W * 0.15)} ${r(o + H)} L ${r(o + W * 0.2)} ${r(o + bh)} H ${r(o + rr)} ` +
        `A ${r(rr)} ${r(rr)} 0 0 1 ${r(o)} ${r(o + bh - rr)} V ${r(o + rr)} A ${r(rr)} ${r(rr)} 0 0 1 ${r(o + rr)} ${r(o)} Z`
      );
    }
    default:
      return pathOf([{ x: o, y: o }, { x: o + W, y: o }, { x: o + W, y: o + H }, { x: o, y: o + H }]);
  }
}

/**
 * Room to keep clear around the text inside a shape (fractions of the box), so
 * text sits in the shape's body rather than its points.
 */
export function textInset(kind: ShapeKind): { x: number; y: number; bottom?: number } {
  switch (kind) {
    case 'triangle':
      return { x: 0.22, y: 0.35, bottom: 0.08 };
    case 'diamond':
    case 'star':
      return { x: 0.22, y: 0.22 };
    case 'hexagon':
    case 'parallelogram':
      return { x: 0.18, y: 0.08 };
    case 'arrow':
      return { x: 0.05, y: 0.25 };
    case 'cylinder':
      return { x: 0.06, y: 0.2 };
    case 'pill':
      return { x: 0.12, y: 0 };
    case 'document':
      return { x: 0.04, y: 0.04, bottom: 0.16 };
    case 'actor':
      return { x: 0, y: 0.72, bottom: 0 };
    case 'bubble':
      return { x: 0.06, y: 0.04, bottom: 0.22 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Where a ray from the middle of a polygon shape toward `toward` (local
 * coordinates) leaves its outline; null for shapes that aren't polygons.
 */
export function polygonExit(kind: ShapeKind, w: number, h: number, toward: Vec): Vec | null {
  const poly = shapePolygon(kind, w, h);
  if (!poly) return null;
  const c = { x: w / 2, y: h / 2 };
  const d = { x: toward.x - c.x, y: toward.y - c.y };
  if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) d.y = -1;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const e = { x: q.x - p.x, y: q.y - p.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p.x - c.x) * e.y - (p.y - c.y) * e.x) / den; // along the ray
    const u = ((p.x - c.x) * d.y - (p.y - c.y) * d.x) / den; // along the edge
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return Number.isFinite(best) ? { x: c.x + d.x * best, y: c.y + d.y * best } : null;
}

/** Size of a new shape when clicked into place (rectangles: ITEM_DEFAULTS). */
export const SHAPE_SIZES: Partial<Record<ShapeKind, { w: number; h: number }>> = {
  triangle: { w: 180, h: 160 },
  diamond: { w: 180, h: 160 },
  hexagon: { w: 200, h: 160 },
  star: { w: 180, h: 170 },
  arrow: { w: 220, h: 120 },
  cylinder: { w: 140, h: 170 },
  pill: { w: 200, h: 80 },
  document: { w: 180, h: 130 },
  class: { w: 220, h: 150 },
  entity: { w: 200, h: 150 },
  actor: { w: 90, h: 160 },
  bubble: { w: 220, h: 150 },
};
