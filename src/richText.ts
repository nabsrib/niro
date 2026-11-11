import type { Item, RunStyle, TextRun } from './types';

/**
 * Rich text helpers (pure): an item's text as styled runs. A run only stores
 * what differs from the item's own style; `item.rich` is absent when no part
 * of the text has its own style.
 */

export const RUN_KEYS: (keyof RunStyle)[] = ['bold', 'italic', 'underline', 'size', 'color'];

/** Whether a run overrides any style. */
const hasStyle = (r: RunStyle) => RUN_KEYS.some((k) => r[k] !== undefined);

/** Whether two runs look the same. */
export const sameStyle = (a: RunStyle, b: RunStyle) => RUN_KEYS.every((k) => a[k] === b[k]);

/** An item's text as runs (one plain run when it has no rich text). */
export const itemRuns = (it: Pick<Item, 'text' | 'rich'>): TextRun[] => it.rich ?? [{ text: it.text }];

/** Plain text of runs. */
export const runsText = (runs: TextRun[]) => runs.map((r) => r.text).join('');

/**
 * Tidy runs: drop empty ones, merge neighbours that look the same, and return
 * undefined when nothing has its own style (the item then stores plain text).
 */
export function normalizeRuns(runs: TextRun[]): TextRun[] | undefined {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const clean: TextRun = { text: r.text };
    for (const k of RUN_KEYS) if (r[k] !== undefined) (clean as unknown as Record<string, unknown>)[k] = r[k];
    const last = out[out.length - 1];
    if (last && sameStyle(last, clean)) last.text += clean.text;
    else out.push(clean);
  }
  return out.some(hasStyle) ? out : undefined;
}

/** Runs without one style override (used when that style is set for the whole item). */
export function stripRunStyle(runs: TextRun[] | undefined, key: keyof RunStyle): TextRun[] | undefined {
  if (!runs) return undefined;
  return normalizeRuns(runs.map((r) => ({ ...r, [key]: undefined })));
}

/** Scale the font sizes in runs (sticky notes scale their text when resized). */
export function scaleRuns(runs: TextRun[] | undefined, k: number): TextRun[] | undefined {
  return runs?.map((r) => (r.size ? { ...r, size: r.size * k } : r));
}

/** CSS (React style object) for a run's overrides. */
export function runCss(r: RunStyle): Record<string, string | number> {
  const css: Record<string, string | number> = {};
  if (r.bold !== undefined) css.fontWeight = r.bold ? 700 : 400;
  if (r.italic !== undefined) css.fontStyle = r.italic ? 'italic' : 'normal';
  if (r.underline !== undefined) css.textDecoration = r.underline ? 'underline' : 'none';
  if (r.size !== undefined) css.fontSize = `${r.size}px`;
  if (r.color !== undefined) css.color = r.color;
  return css;
}
