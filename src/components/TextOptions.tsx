import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { TEXT_COLORS, TEXT_SIZES, textAlign, textColor, textVAlign, type HAlign, type VAlign } from '../textStyle';
import { getRichEdit } from '../editing';
import { stripRunStyle } from '../richText';
import type { Item, RunStyle } from '../types';
import { Icons } from './Icons';

const H_NEXT: Record<HAlign, HAlign> = { left: 'center', center: 'right', right: 'left' };
const V_NEXT: Record<VAlign, VAlign> = { top: 'middle', middle: 'bottom', bottom: 'top' };
const H_ICON = { left: Icons.alignLeft, center: Icons.alignCenter, right: Icons.alignRight };
const V_ICON = { top: Icons.alignTop, middle: Icons.alignMiddle, bottom: Icons.alignBottom };

/**
 * Text options in the context toolbar for selected stickies, shapes and text
 * (like Miro): font size, bold, italic, underline, horizontal and vertical
 * alignment, text color. Every change is one undo step.
 *
 * While typing (`editing`), size / bold / italic / underline / color style the
 * selected part of the text (rich text); with nothing selected they apply to
 * the whole item. Alignment always applies to the whole item.
 */
export function TextOptions({ items, editing = false }: { items: Item[]; editing?: boolean }) {
  const restyle = useBoard((s) => s.restyleItems);
  const ids = items.map((it) => it.id);
  const [colorsOpen, setColorsOpen] = useState(false);
  const key = ids.join(',');
  useEffect(() => setColorsOpen(false), [key]);

  // While typing, follow the text selection to show the style under it.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!editing) return;
    const onSelection = () => tick((n) => n + 1);
    document.addEventListener('selectionchange', onSelection);
    onSelection();
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [editing]);
  const rich = editing ? getRichEdit() : null;
  const at: RunStyle = rich?.current() ?? {};

  /** Style the selected text if there is a selection, else the whole item(s). */
  const apply = (patch: RunStyle, whole: (it: Item) => Partial<Item>) => {
    if (rich && rich.apply(patch)) {
      tick((n) => n + 1);
      return;
    }
    restyle(ids, whole);
  };

  const first = items[0];
  const sizes = new Set(items.map((it) => Math.round(it.fontSize)));
  const size = editing ? Math.round(at.size ?? first.fontSize) : sizes.size === 1 ? [...sizes][0] : null;
  const sizeOptions = size !== null && !TEXT_SIZES.includes(size) ? [...TEXT_SIZES, size].sort((a, b) => a - b) : TEXT_SIZES;
  const all = (flag: 'bold' | 'italic' | 'underline') =>
    editing ? (at[flag] ?? !!first[flag]) : items.every((it) => it[flag]);
  const toggle = (flag: 'bold' | 'italic' | 'underline') => {
    const on = !all(flag);
    apply({ [flag]: on }, (it) => ({ [flag]: on || undefined, rich: stripRunStyle(it.rich, flag) }));
  };
  const align = textAlign(first);
  const valign = textVAlign(first);
  const showV = items.every((it) => it.type !== 'text');
  const AlignIcon = H_ICON[align];
  const VAlignIcon = V_ICON[valign];
  const color = editing ? (at.color ?? textColor(first)) : textColor(first);

  return (
    <>
      <select
        className="font-size"
        value={size ?? ''}
        title="Text size"
        aria-label="Text size"
        onChange={(e) => {
          const v = Number(e.target.value);
          // Hand keyboard shortcuts back to the board (while typing, the editor takes focus back).
          if (!editing) e.currentTarget.blur();
          apply({ size: v }, (it) => ({ fontSize: v, rich: stripRunStyle(it.rich, 'size') }));
        }}
      >
        {size === null && <option value="">–</option>}
        {sizeOptions.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button
        className={`icon-btn text-btn text-btn--bold${all('bold') ? ' icon-btn--active' : ''}`}
        title="Bold"
        aria-label="Bold"
        aria-pressed={all('bold')}
        onClick={() => toggle('bold')}
      >
        B
      </button>
      <button
        className={`icon-btn text-btn text-btn--italic${all('italic') ? ' icon-btn--active' : ''}`}
        title="Italic"
        aria-label="Italic"
        aria-pressed={all('italic')}
        onClick={() => toggle('italic')}
      >
        I
      </button>
      <button
        className={`icon-btn text-btn text-btn--underline${all('underline') ? ' icon-btn--active' : ''}`}
        title="Underline"
        aria-label="Underline"
        aria-pressed={all('underline')}
        onClick={() => toggle('underline')}
      >
        U
      </button>
      <button
        className="icon-btn"
        title={`Align ${align} (click for ${H_NEXT[align]})`}
        aria-label={`Text align: ${align}`}
        onClick={() => restyle(ids, () => ({ align: H_NEXT[align] }))}
      >
        <AlignIcon />
      </button>
      {showV && (
        <button
          className="icon-btn"
          title={`Text at the ${valign} (click for ${V_NEXT[valign]})`}
          aria-label={`Vertical align: ${valign}`}
          onClick={() => restyle(ids, () => ({ valign: V_NEXT[valign] }))}
        >
          <VAlignIcon />
        </button>
      )}
      <div className="text-color">
        <button
          className={`icon-btn${colorsOpen ? ' icon-btn--active' : ''}`}
          title="Text color"
          aria-label="Text color"
          aria-expanded={colorsOpen}
          onClick={() => setColorsOpen((o) => !o)}
        >
          <span className="text-color__glyph">
            A
            <span className="text-color__bar" style={{ background: color }} />
          </span>
        </button>
        {colorsOpen && (
          <div className="text-color__menu">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${color.toLowerCase() === c.toLowerCase() ? ' swatch--active' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={`Text color ${c}`}
                onClick={() => {
                  // Text items keep their text color in `color`; stickies and shapes in `textColor`.
                  apply({ color: c }, (it) => ({
                    ...(it.type === 'text' ? { color: c } : { textColor: c }),
                    rich: stripRunStyle(it.rich, 'color'),
                  }));
                  setColorsOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
      {!editing && <div className="divider" />}
    </>
  );
}
