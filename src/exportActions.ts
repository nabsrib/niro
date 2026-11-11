import { useBoard } from './store';
import { commitActiveEdit } from './editing';
import { collectExport, contentToSvg, type ExportArea, type Measure } from './exportImage';

/** Browser limits for canvas size; bigger PNG exports are scaled down to fit. */
const MAX_SIDE = 16384;
const MAX_AREA = 120_000_000;

let measureCtx: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

/** Text width through a canvas, with the same fonts the board uses (cached). */
export const measureText: Measure = (text, font) => {
  const key = `${font}\u0000${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  const w = measureCtx.measureText(text).width;
  if (widths.size > 20_000) widths.clear();
  widths.set(key, w);
  return w;
};

/**
 * Draw an SVG onto a canvas at `scale` and return it as a PNG. The scale is
 * reduced when the image would exceed the browser's canvas limits.
 */
/** The scale a w×h PNG can really use: `scale`, reduced to fit the browser's canvas limits. */
export function fitScale(w: number, h: number, scale: number): number {
  return Math.min(scale, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
}

export async function svgToPng(svg: string, w: number, h: number, scale: number): Promise<{ blob: Blob; scale: number }> {
  const k = fitScale(w, h, scale);
  const width = Math.max(1, Math.round(w * k));
  const height = Math.max(1, Math.round(h * k));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is not available');
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('the image is too large for this browser');
  return { blob, scale: k };
}

/** Save a file through the browser's download flow. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File-name-safe version of a name. */
const slug = (s: string) => s.trim().replace(/[\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'niro';

export type ExportBackground = 'white' | 'board' | 'transparent';
/** White, the canvas grey (so white frames stand out like on the board), or none. */
const BACKGROUNDS: Record<ExportBackground, string | null> = { white: '#ffffff', board: '#f2f2f2', transparent: null };

export interface ExportRequest {
  area: ExportArea;
  format: 'png' | 'svg';
  /** PNG only: 1 = one pixel per world unit. */
  scale: number;
  background: ExportBackground;
}

/**
 * What an export would contain, laid out for its real image scale: frame
 * titles and margins keep their pixel size, so a big board shrunk to fit the
 * browser's limits gets more room for them. `pxPerUnit` is that real scale.
 */
function prepare(area: ExportArea, format: 'png' | 'svg', scale: number) {
  const s = useBoard.getState();
  const first = collectExport(area, s.items, s.order, s.connectors, s.selected);
  if (!first || format === 'svg') return first && { content: first, pxPerUnit: 1 };
  let k = fitScale(first.bounds.w, first.bounds.h, scale);
  const content = collectExport(area, s.items, s.order, s.connectors, s.selected, k) ?? first;
  k = fitScale(content.bounds.w, content.bounds.h, scale);
  return { content, pxPerUnit: k };
}

/** Image size in pixels for the dialog, and whether it had to be shrunk; null if empty. */
export function exportPixels(area: ExportArea, format: 'png' | 'svg', scale: number) {
  const p = prepare(area, format, scale);
  if (!p) return null;
  const k = format === 'png' ? p.pxPerUnit : 1;
  return {
    w: Math.round(p.content.bounds.w * k),
    h: Math.round(p.content.bounds.h * k),
    shrunk: format === 'png' && k < scale - 0.01,
    scale: k,
  };
}

/** Export as PNG (text wrapped by the browser) or SVG (text split into lines by niro). */
export async function runExport(req: ExportRequest): Promise<void> {
  commitActiveEdit();
  const s = useBoard.getState();
  const prepared = prepare(req.area, req.format, req.scale);
  if (!prepared) {
    s.showNotice('There is nothing to export there.', 'error');
    return;
  }
  const { content, pxPerUnit } = prepared;
  const board = s.boards.find((b) => b.id === s.boardId)?.name ?? 'niro';
  const part =
    req.area.kind === 'frame' ? s.items[req.area.frameId]?.text || 'frame' : req.area.kind === 'selection' ? 'selection' : '';
  const name = slug(part ? `${board} ${part}` : board);
  const svg = contentToSvg(content, s.items, {
    textMode: req.format === 'png' ? 'html' : 'lines',
    measure: measureText,
    background: BACKGROUNDS[req.background],
    pxPerUnit,
  });
  try {
    if (req.format === 'svg') {
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
      s.showNotice('Exported SVG.');
      return;
    }
    const { blob, scale } = await svgToPng(svg, content.bounds.w, content.bounds.h, pxPerUnit);
    downloadBlob(blob, `${name}.png`);
    s.showNotice(
      scale < req.scale - 0.01
        ? `Exported PNG, shrunk to ${scale.toFixed(2)}× to fit the browser's image size limit.`
        : `Exported PNG at ${req.scale}×.`,
    );
  } catch (err) {
    s.showNotice(`Could not export the image: ${(err as Error).message}`, 'error');
  }
}
