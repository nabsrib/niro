import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { BORDER_COLORS, BORDER_WIDTHS, SHAPES, borderColor, borderDash, borderWidth, shapeOf } from '../shapes';
import type { Item, LineDash, ShapeKind } from '../types';

/** The value shared by all items, or '' when they differ. */
function common<T>(items: Item[], get: (it: Item) => T): T | '' {
  const vals = new Set(items.map(get));
  return vals.size === 1 ? [...vals][0] : '';
}

/**
 * Toolbar controls for selected rectangles and ellipses: the shape (rectangles
 * only), and the border's color, width and pattern. Each change is one undo step.
 */
export function ShapeStyle({ items }: { items: Item[] }) {
  const s = useBoard.getState();
  const ids = items.map((it) => it.id);
  const allRects = items.every((it) => it.type === 'rect');
  const kind = common(items, shapeOf);
  const width = common(items, borderWidth);
  const dash = common(items, (it) => borderDash(it) ?? 'solid');
  const color = common(items, borderColor);
  const [open, setOpen] = useState(false);
  const key = ids.join(',');
  useEffect(() => setOpen(false), [key]);

  return (
    <>
      {allRects && (
        <select
          className="font-size line-select"
          value={kind}
          title="Shape"
          aria-label="Shape"
          onChange={(e) => {
            const shape = e.target.value as ShapeKind;
            s.restyleItems(ids, () => ({ shape: shape === 'rect' ? undefined : shape }));
          }}
        >
          {kind === '' && <option value="">Shape…</option>}
          {SHAPES.map((sh) => (
            <option key={sh.kind} value={sh.kind}>
              {sh.label}
            </option>
          ))}
        </select>
      )}
      <div className="text-color">
        <button
          className={`icon-btn${open ? ' icon-btn--active' : ''}`}
          title="Border color"
          aria-label="Border color"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="border-glyph" style={{ borderColor: color || '#c4c4cc' }} />
        </button>
        {open && (
          <div className="text-color__menu">
            {BORDER_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${typeof color === 'string' && color.toLowerCase() === c.toLowerCase() ? ' swatch--active' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={`Border color ${c}`}
                onClick={() => {
                  // Picking a color on a borderless shape gives it the default width too.
                  s.restyleItems(ids, (it) => ({ border: c, ...(borderWidth(it) === 0 ? { borderWidth: 2 } : {}) }));
                  setOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <select
        className="font-size line-select"
        value={width === '' ? '' : String(width)}
        title="Border width"
        aria-label="Border width"
        onChange={(e) => s.restyleItems(ids, () => ({ borderWidth: Number(e.target.value) }))}
      >
        {width === '' && <option value="">Border…</option>}
        {(width !== '' && !BORDER_WIDTHS.includes(width) ? [...BORDER_WIDTHS, width].sort((a, b) => a - b) : BORDER_WIDTHS).map((w) => (
          <option key={w} value={w}>
            {w === 0 ? 'No border' : `Border ${w}`}
          </option>
        ))}
      </select>
      <select
        className="font-size line-select"
        value={dash}
        title="Border pattern"
        aria-label="Border pattern"
        onChange={(e) =>
          s.restyleItems(ids, () => ({ borderDash: e.target.value === 'solid' ? undefined : (e.target.value as LineDash) }))
        }
      >
        {dash === '' && <option value="">Pattern…</option>}
        <option value="solid">━━ Solid</option>
        <option value="dashed">╍╍ Dashed</option>
        <option value="dotted">┈┈ Dotted</option>
      </select>
    </>
  );
}
