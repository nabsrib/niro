import type { Box, Connector, Item } from './types';
import { boundsOf, intersects } from './geometry';
import { LABEL_DEFAULTS, connectorGeometry, pointAlong } from './connectors';
import { isDeck, isFrame, renderOrder, withFrameChildren } from './frames';
import { pathPoints, smoothPath } from './pen';
import { textOn } from './colors';

/**
 * Image export: draws board content as an SVG string from board data (not the
 * DOM, which viewport culling leaves incomplete). Pure: text measuring is
 * passed in, so the browser-specific part stays in `exportActions.ts`.
 *
 * Two ways to write text:
 * - `html`: text in small HTML boxes (`foreignObject`), wrapped by the browser
 *   exactly like the board. Used for PNG, which the browser draws.
 * - `lines`: niro splits text into lines itself (plain SVG `<text>`), so the
 *   SVG works in Figma, Illustrator, Inkscape... Used for SVG files.
 */

type ItemMap = Record<string, Item | undefined>;

export type TextMode = 'html' | 'lines';
/** Width of `text` in pixels for a CSS font shorthand like `20px Inter`. */
export type Measure = (text: string, font: string) => number;

/**
 * What to export: everything, the selection, one frame (cropped to it), what
 * is on screen now (`view`, turned into a region by the caller), or a custom
 * region picked on the board (cropped to it).
 */
export type ExportArea =
  | { kind: 'board' }
  | { kind: 'selection' }
  | { kind: 'frame'; frameId: string }
  | { kind: 'view' }
  | { kind: 'region'; box: Box };

/** Same font stack as the app (`:root` in styles.css). */
export const FONT_FAMILY = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const LINE_HEIGHT = 1.3;
const LABEL_LINE_HEIGHT = 1.35;
const INK = '#1a1a1a';
/** Space around the content when exporting the board or a selection. */
const MARGIN = 40;
/**
 * Frame titles sit above the frame. Like on the board, they keep a constant
 * size in the final image (pixels), whatever the export scale.
 */
const TITLE_SIZE = 14;
/** Room reserved above frames for their titles, in image pixels. */
export const TITLE_SPACE = 28;
/** Frame outline width in image pixels (kept at any scale). */
const FRAME_STROKE = 1.5;

export interface ExportContent {
  /** Items in render order (frames first). */
  items: Item[];
  connectors: Connector[];
  /** World area the image covers. */
  bounds: Box;
  /** Frame export: crop to the frame and leave out its title. */
  cropped: boolean;
}

/**
 * Pick what an export area contains. Frames bring their contents along;
 * connectors come along when both ends are included (or they are selected).
 * Returns null when there is nothing to export.
 */
export function collectExport(
  area: Exclude<ExportArea, { kind: 'view' }>,
  items: ItemMap,
  order: string[],
  connectors: Record<string, Connector>,
  selected: string[],
  /** Image pixels per board unit; titles and margins keep their pixel size. */
  pxPerUnit = 1,
): ExportContent | null {
  // A region: everything that touches it, cropped to it.
  if (area.kind === 'region') {
    const box = area.box;
    const inside = renderOrder(order, items)
      .map((id) => items[id])
      .filter((it): it is Item => !!it && intersects(it, box));
    const conns = Object.values(connectors).filter((c) => {
      const g = connectorGeometry(c, items);
      return !!g && intersects(g.bounds, box);
    });
    if (!inside.length && !conns.length) return null;
    return { items: inside, connectors: conns, bounds: box, cropped: false };
  }
  let ids: string[];
  let extraConnectors: string[] = [];
  if (area.kind === 'board') ids = order;
  else if (area.kind === 'selection') {
    ids = withFrameChildren(selected.filter((id) => items[id]), items, order);
    extraConnectors = selected.filter((id) => connectors[id]);
  } else {
    if (!isFrame(items[area.frameId])) return null;
    ids = withFrameChildren([area.frameId], items, order);
  }
  const idSet = new Set(ids);
  const included = renderOrder(order, items).filter((id) => idSet.has(id)).map((id) => items[id]!);
  const attachedIn = (c: Connector) =>
    [c.from, c.to].every((e) => e.kind === 'point' || idSet.has(e.itemId));
  const conns = Object.values(connectors).filter(
    (c) => area.kind === 'board' || extraConnectors.includes(c.id) || (attachedIn(c) && (c.from.kind === 'item' || c.to.kind === 'item')),
  );
  if (!included.length && !conns.length) return null;

  if (area.kind === 'frame') {
    const f = items[area.frameId]!;
    return { items: included, connectors: conns, bounds: { x: f.x, y: f.y, w: f.w, h: f.h }, cropped: true };
  }
  const titleSpace = TITLE_SPACE / pxPerUnit;
  const boxes: Box[] = included.map((it) =>
    isFrame(it) ? { x: it.x, y: it.y - titleSpace, w: it.w, h: it.h + titleSpace } : it,
  );
  for (const c of conns) {
    const g = connectorGeometry(c, items);
    if (g) boxes.push(g.bounds);
  }
  const b = boundsOf(boxes)!;
  const margin = MARGIN / Math.min(pxPerUnit, 1);
  return {
    items: included,
    connectors: conns,
    bounds: { x: b.x - margin, y: b.y - margin, w: b.w + margin * 2, h: b.h + margin * 2 },
    cropped: false,
  };
}

// ---------- text ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT_FAMILY}`;

/**
 * Split `text` into lines no wider than `maxWidth`, like the board's CSS
 * (`white-space: pre-wrap; overflow-wrap: anywhere`): typed line breaks are
 * kept, lines break between words, and a word too long for a line is split.
 */
export function wrapLines(text: string, maxWidth: number, fontCss: string, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    const push = () => {
      out.push(line.trimEnd());
      line = '';
    };
    for (const token of para.split(/(\s+)/).filter((t) => t.length)) {
      // Trailing spaces never push a line over (CSS lets them hang).
      if (measure((line + token).trimEnd(), fontCss) <= maxWidth) {
        line += token;
        continue;
      }
      if (line.trim()) push();
      line = '';
      if (measure(token, fontCss) <= maxWidth) {
        line = token;
        continue;
      }
      // A word too long for a whole line: split it by characters.
      for (const ch of token) {
        if (line && measure(line + ch, fontCss) > maxWidth) push();
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** HTML text box (for PNG): the browser wraps and aligns it like the board. */
function htmlText(box: Box, text: string, size: number, color: string, align: 'center' | 'top-left', clip: boolean): string {
  const centered = align === 'center';
  const style = [
    'width:100%',
    'height:100%',
    'box-sizing:border-box',
    `display:${centered ? 'flex' : 'block'}`,
    'align-items:center',
    'justify-content:center',
    `text-align:${centered ? 'center' : 'left'}`,
    `font:${size}px/${LINE_HEIGHT} ${FONT_FAMILY}`,
    `color:${color}`,
    'white-space:pre-wrap',
    'overflow-wrap:anywhere',
    `overflow:${clip ? 'hidden' : 'visible'}`,
    'margin:0',
  ].join(';');
  return (
    `<foreignObject x="${box.x}" y="${box.y}" width="${Math.max(box.w, 1)}" height="${Math.max(box.h, 1)}"${clip ? '' : ' overflow="visible"'}>` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${esc(style)}"><div style="width:100%">${esc(text)}</div></div></foreignObject>`
  );
}

/** Plain SVG text (for SVG files): lines measured and placed by niro. */
function svgText(
  box: Box,
  text: string,
  size: number,
  color: string,
  align: 'center' | 'top-left',
  measure: Measure,
  lineHeight = LINE_HEIGHT,
): string {
  const lines = wrapLines(text, Math.max(box.w, 1), font(size), measure);
  const lh = size * lineHeight;
  const total = lines.length * lh;
  const centered = align === 'center';
  // First baseline: half the line's extra space plus ~0.8em from the line top.
  const top = centered ? box.y + (box.h - total) / 2 : box.y;
  const x = centered ? box.x + box.w / 2 : box.x;
  const tspans = lines
    .map((l, i) => `<tspan x="${x}" y="${top + i * lh + (lh - size) / 2 + size * 0.8}">${esc(l) || ' '}</tspan>`)
    .join('');
  return (
    `<text font-family="${esc(FONT_FAMILY)}" font-size="${size}" fill="${color}"` +
    `${centered ? ' text-anchor="middle"' : ''} xml:space="preserve">${tspans}</text>`
  );
}

// ---------- items and connectors ----------

function renderItem(it: Item, opts: SvgOptions, cropped: boolean, idx: number): string {
  const { textMode, measure, pxPerUnit } = opts;
  // Lines never get thinner than one image pixel, even when a big board is shrunk.
  const line = (w: number) => Math.max(w, 1 / pxPerUnit);
  const text = (box: Box, size: number, color: string, align: 'center' | 'top-left', clip: boolean) =>
    !it.text
      ? ''
      : textMode === 'html'
        ? htmlText(box, it.text, size, color, align, clip)
        : svgText(box, it.text, size, color, align, measure);

  switch (it.type) {
    case 'frame': {
      const deck = isDeck(it);
      // Title and outline keep their pixel size in the image, like on the board.
      const title =
        cropped || !it.text
          ? ''
          : `<text x="${it.x}" y="${it.y - 8 / pxPerUnit}" font-family="${esc(FONT_FAMILY)}" font-size="${TITLE_SIZE / pxPerUnit}" fill="#6b6b76">${esc(it.text)}</text>`;
      return (
        `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${deck ? 12 : 2}" fill="${it.fill}"` +
        `${deck ? '' : ` stroke="#c4c4cc" stroke-width="${FRAME_STROKE}" vector-effect="non-scaling-stroke"`}/>${title}`
      );
    }
    case 'path': {
      const d = smoothPath(pathPoints(it));
      const hl = it.highlight ? ' opacity="0.5" style="mix-blend-mode:multiply"' : '';
      return (
        `<path transform="translate(${it.x} ${it.y})" d="${d}" fill="none" stroke="${it.color}" stroke-width="${line(it.strokeWidth ?? 3)}"` +
        ` stroke-linecap="round" stroke-linejoin="round"${hl}/>`
      );
    }
    case 'text':
      // Text items: no padding, aligned top-left, height fits the text.
      return text({ x: it.x, y: it.y, w: it.w, h: it.h }, it.fontSize, it.color, 'top-left', false);
    default: {
      // Sticky / rect / ellipse: centered text inside 0.6em padding (+ 2px border on shapes), clipped.
      const border = it.type === 'sticky' ? 0 : 2;
      const pad = it.fontSize * 0.6 + border;
      const inner = { x: it.x + pad, y: it.y + pad, w: it.w - pad * 2, h: it.h - pad * 2 };
      const color = textOn(it.fill);
      let shape: string;
      if (it.type === 'ellipse') {
        shape = `<ellipse cx="${it.x + it.w / 2}" cy="${it.y + it.h / 2}" rx="${it.w / 2 - 1}" ry="${it.h / 2 - 1}" fill="${it.fill}" stroke="${INK}" stroke-width="${line(2)}"/>`;
      } else if (it.type === 'rect') {
        shape = `<rect x="${it.x + 1}" y="${it.y + 1}" width="${it.w - 2}" height="${it.h - 2}" rx="2" fill="${it.fill}" stroke="${INK}" stroke-width="${line(2)}"/>`;
      } else {
        shape = `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${it.fill}" filter="url(#niro-shadow)"/>`;
      }
      if (!it.text) return shape;
      // Clip the text to the item, like the board's `overflow: hidden`.
      const clipId = `niro-clip-${idx}`;
      return (
        `${shape}<clipPath id="${clipId}"><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"/></clipPath>` +
        `<g clip-path="url(#${clipId})">${text(inner, it.fontSize, color, 'center', true)}</g>`
      );
    }
  }
}

function renderConnector(c: Connector, items: ItemMap, opts: SvgOptions, idx: number): string {
  const g = connectorGeometry(c, items);
  if (!g) return '';
  const width = Math.max(c.strokeWidth, 1 / opts.pxPerUnit);
  let out = '';
  let mask = '';
  if (c.label) {
    const size = c.labelSize ?? LABEL_DEFAULTS.size;
    const color = c.labelColor ?? LABEL_DEFAULTS.color;
    const at = pointAlong(g.samples, c.labelAt ?? 0.5);
    const lines = wrapLines(c.label, size * 14 - size * 0.4, font(size), opts.measure);
    const w = Math.max(...lines.map((l) => opts.measure(l, font(size))), size * 0.5);
    const h = lines.length * size * LABEL_LINE_HEIGHT;
    const box = { x: at.x - w / 2, y: at.y - h / 2, w, h };
    // Cut the line where the label sits, like the board does.
    const maskId = `niro-label-${idx}`;
    const m = c.strokeWidth * 2 + 20;
    const bb = g.bounds;
    out +=
      `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${bb.x - m}" y="${bb.y - m}" width="${bb.w + m * 2}" height="${bb.h + m * 2}">` +
      `<rect x="${bb.x - m}" y="${bb.y - m}" width="${bb.w + m * 2}" height="${bb.h + m * 2}" fill="white"/>` +
      `<rect x="${box.x - 4}" y="${box.y - 2}" width="${w + 8}" height="${h + 4}" rx="4" fill="black"/></mask>`;
    mask = ` mask="url(#${maskId})"`;
    const label =
      opts.textMode === 'html'
        ? htmlText({ x: box.x - size, y: box.y, w: w + size * 2, h }, c.label, size, color, 'center', false)
        : svgText(box, c.label, size, color, 'center', opts.measure, LABEL_LINE_HEIGHT);
    out += `<path d="${g.d}" fill="none" stroke="${c.stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${mask}/>`;
    if (g.startHead) out += `<path d="${g.startHead}" fill="${c.stroke}" stroke="${c.stroke}" stroke-linejoin="round"/>`;
    if (g.endHead) out += `<path d="${g.endHead}" fill="${c.stroke}" stroke="${c.stroke}" stroke-linejoin="round"/>`;
    return out + label;
  }
  out += `<path d="${g.d}" fill="none" stroke="${c.stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (g.startHead) out += `<path d="${g.startHead}" fill="${c.stroke}" stroke="${c.stroke}" stroke-linejoin="round"/>`;
  if (g.endHead) out += `<path d="${g.endHead}" fill="${c.stroke}" stroke="${c.stroke}" stroke-linejoin="round"/>`;
  return out;
}

export interface SvgOptions {
  textMode: TextMode;
  measure: Measure;
  /** Background color, or null for transparent. */
  background: string | null;
  /** Image pixels per board unit (SVG files: 1). Keeps titles, outlines and thin lines visible. */
  pxPerUnit: number;
}

/**
 * The SVG document for `content`, in world units (1 unit = 1 px at 1×).
 * `allItems` resolves connector ends attached to items outside the content.
 */
export function contentToSvg(content: ExportContent, allItems: ItemMap, opts: SvgOptions): string {
  const b = content.bounds;
  const body = [
    ...content.items.map((it, i) => renderItem(it, opts, content.cropped, i)),
    ...content.connectors.map((c, i) => renderConnector(c, allItems, opts, i)),
  ].join('\n');
  const bg = opts.background ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${opts.background}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">\n` +
    `<defs><filter id="niro-shadow" x="-10%" y="-10%" width="120%" height="130%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.16"/></filter></defs>\n` +
    `${bg}\n${body}\n</svg>`
  );
}
