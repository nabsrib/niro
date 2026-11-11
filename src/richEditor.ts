import type { RunStyle, TextRun } from './types';
import { RUN_KEYS } from './richText';

/**
 * DOM side of rich text editing (browser only): fill the editor from runs,
 * read runs back from it, and style the selected part.
 */

/** CSS property for each run style. */
const CSS_PROP: Record<keyof RunStyle, string> = {
  bold: 'font-weight',
  italic: 'font-style',
  underline: 'text-decoration',
  size: 'font-size',
  color: 'color',
};

function setStyle(el: HTMLElement, r: RunStyle) {
  if (r.bold !== undefined) el.style.fontWeight = r.bold ? '700' : '400';
  if (r.italic !== undefined) el.style.fontStyle = r.italic ? 'italic' : 'normal';
  if (r.underline !== undefined) el.style.textDecoration = r.underline ? 'underline' : 'none';
  if (r.size !== undefined) el.style.fontSize = `${r.size}px`;
  if (r.color !== undefined) el.style.color = r.color;
}

/** Fill the editor with runs (text nodes, plus spans for styled runs). */
export function runsToDom(el: HTMLElement, runs: TextRun[]) {
  el.textContent = '';
  for (const r of runs) {
    if (RUN_KEYS.some((k) => r[k] !== undefined)) {
      const span = document.createElement('span');
      setStyle(span, r);
      span.textContent = r.text;
      el.appendChild(span);
    } else {
      el.appendChild(document.createTextNode(r.text));
    }
  }
}

/** '#rrggbb' for a CSS color like 'rgb(1, 2, 3)'; hex colors pass through. */
function toHex(c: string): string | undefined {
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return undefined;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Style overrides an element adds (inline styles and b / i / u tags, e.g. from Ctrl+B). */
function readStyle(el: HTMLElement): RunStyle {
  const r: RunStyle = {};
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') r.bold = true;
  if (tag === 'I' || tag === 'EM') r.italic = true;
  if (tag === 'U') r.underline = true;
  const s = el.style;
  if (s.fontWeight) r.bold = s.fontWeight === 'bold' || Number(s.fontWeight) >= 600;
  if (s.fontStyle) r.italic = s.fontStyle === 'italic';
  const deco = s.textDecorationLine || s.textDecoration;
  if (deco) r.underline = deco.includes('underline');
  if (s.fontSize.endsWith('px')) r.size = parseFloat(s.fontSize);
  if (s.color) {
    const hex = toHex(s.color);
    if (hex) r.color = hex;
  }
  return r;
}

/** Read the editor back as plain text and runs. */
export function domToRuns(el: HTMLElement): { text: string; runs: TextRun[] } {
  const runs: TextRun[] = [];
  const push = (text: string, st: RunStyle) => runs.push({ ...st, text });
  const endsWithBreak = () => runs.length > 0 && runs[runs.length - 1].text.endsWith('\n');
  const walk = (node: Node, st: RunStyle, root: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      push((node as Text).data, st);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') {
      push('\n', st);
      return;
    }
    // Browsers may wrap new lines in <div>s: each one starts a new line.
    if (!root && (node.tagName === 'DIV' || node.tagName === 'P') && runs.length && !endsWithBreak()) push('\n', st);
    const next = { ...st, ...readStyle(node) };
    node.childNodes.forEach((c) => walk(c, next, false));
  };
  walk(el, {}, true);
  // contentEditable keeps a trailing line break to show the caret on an empty last line.
  const last = runs[runs.length - 1];
  if (last && last.text.endsWith('\n')) last.text = last.text.slice(0, -1);
  return { text: runs.map((r) => r.text).join(''), runs };
}

/** Remove the given style overrides from everything inside `root` (so a new style wins). */
function stripStyles(root: Node, keys: (keyof RunStyle)[]) {
  const els = root instanceof Element || root instanceof DocumentFragment ? Array.from(root.querySelectorAll('*')) : [];
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;
    for (const key of keys) el.style.removeProperty(CSS_PROP[key]);
    if (keys.includes('underline')) el.style.removeProperty('text-decoration-line');
    const tag = el.tagName;
    const unwrap =
      ((tag === 'B' || tag === 'STRONG') && keys.includes('bold')) ||
      ((tag === 'I' || tag === 'EM') && keys.includes('italic')) ||
      (tag === 'U' && keys.includes('underline'));
    if (unwrap) el.replaceWith(...Array.from(el.childNodes));
  }
}

/**
 * Style the selected text: wraps the range in a span with `patch` (removing
 * the same styles inside it first) and returns a range selecting it.
 */
export function styleRange(range: Range, patch: RunStyle): Range {
  const keys = (Object.keys(patch) as (keyof RunStyle)[]).filter((key) => patch[key] !== undefined);
  const frag = range.extractContents();
  stripStyles(frag, keys);
  const span = document.createElement('span');
  setStyle(span, patch);
  span.appendChild(frag);
  range.insertNode(span);
  const r = document.createRange();
  r.selectNodeContents(span);
  return r;
}

/** Remove style overrides from the whole editor (that style is being set for the whole item). */
export function clearStyles(el: HTMLElement, keys: (keyof RunStyle)[]) {
  stripStyles(el, keys);
}

/** Style overrides in effect at a point in the editor (nearest override wins). */
export function styleAt(el: HTMLElement, node: Node | null): RunStyle {
  const chain: HTMLElement[] = [];
  for (let n: Node | null = node; n && n !== el; n = n.parentNode) if (n instanceof HTMLElement) chain.push(n);
  const out: RunStyle = {};
  for (const e of chain.reverse()) Object.assign(out, readStyle(e));
  return out;
}
