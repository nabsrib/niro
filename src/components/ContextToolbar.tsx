import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { LABEL_COLORS, LABEL_DEFAULTS, LABEL_SIZES } from '../connectors';
import { PALETTE } from '../colors';
import type { ConnectorStyle } from '../types';
import { Icons } from './Icons';
import { tooltip } from '../shortcuts';

type ScreenBox = { left: number; top: number; width: number; height: number };

const STYLES: { style: ConnectorStyle; label: string; Icon: () => React.JSX.Element }[] = [
  { style: 'straight', label: 'Straight line', Icon: Icons.lineStraight },
  { style: 'elbow', label: 'Elbow line', Icon: Icons.lineElbow },
  { style: 'curved', label: 'Curved line', Icon: Icons.lineCurved },
];

/** Floating toolbar above the current selection (items and/or connectors). */
export function ContextToolbar({ box, ids }: { box: ScreenBox; ids: string[] }) {
  const s = useBoard.getState();
  const items = useBoard((st) => st.items);
  const connectors = useBoard((st) => st.connectors);
  const selItems = ids.map((id) => items[id]).filter(Boolean);
  const selConns = ids.map((id) => connectors[id]).filter(Boolean);

  const first = selItems[0];
  const current = first
    ? first.type === 'text' || first.type === 'path'
      ? first.color
      : first.fill
    : selConns[0]?.stroke;
  const connIds = selConns.map((c) => c.id);
  const allStyle = (style: ConnectorStyle) => selConns.length > 0 && selConns.every((c) => c.style === style);
  const allStart = selConns.length > 0 && selConns.every((c) => c.startArrow === 'arrow');
  const allEnd = selConns.length > 0 && selConns.every((c) => c.endArrow === 'arrow');
  const bentIds = selConns.filter((c) => c.style === 'curved' && c.bend).map((c) => c.id);

  // Label text options apply to every selected connector that has a label.
  const labeled = selConns.filter((c) => c.label);
  const labeledIds = labeled.map((c) => c.id);
  const sizes = new Set(labeled.map((c) => c.labelSize ?? LABEL_DEFAULTS.size));
  const labelSize = sizes.size === 1 ? [...sizes][0] : null;
  const sizeOptions =
    labelSize !== null && !LABEL_SIZES.includes(labelSize)
      ? [...LABEL_SIZES, labelSize].sort((a, b) => a - b)
      : LABEL_SIZES;
  const labelColor = labeled[0]?.labelColor ?? LABEL_DEFAULTS.color;
  const [colorsOpen, setColorsOpen] = useState(false);
  const selectionKey = ids.join(',');
  useEffect(() => setColorsOpen(false), [selectionKey]);

  // Flip below the selection when there is no room above it.
  const above = box.top > 70;
  const style = {
    left: box.left + box.width / 2,
    top: above ? box.top - 14 : box.top + box.height + 14,
    transform: `translate(-50%, ${above ? '-100%' : '0'})`,
  };

  return (
    <div className="context-toolbar" style={style} data-ui onPointerDown={(e) => e.stopPropagation()}>
      {selConns.length > 0 && (
        <>
          {STYLES.map(({ style: st, label, Icon }) => (
            <button
              key={st}
              className={`icon-btn${allStyle(st) ? ' icon-btn--active' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={allStyle(st)}
              onClick={() => s.styleConnectors(connIds, { style: st })}
            >
              <Icon />
            </button>
          ))}
          <div className="divider" />
          <button
            className={`icon-btn${allStart ? ' icon-btn--active' : ''}`}
            title="Start arrow"
            aria-label="Start arrow"
            aria-pressed={allStart}
            onClick={() => s.styleConnectors(connIds, { startArrow: allStart ? 'none' : 'arrow' })}
          >
            <Icons.arrowStart />
          </button>
          <button
            className={`icon-btn${allEnd ? ' icon-btn--active' : ''}`}
            title="End arrow"
            aria-label="End arrow"
            aria-pressed={allEnd}
            onClick={() => s.styleConnectors(connIds, { endArrow: allEnd ? 'none' : 'arrow' })}
          >
            <Icons.arrowEnd />
          </button>
          {bentIds.length > 0 && (
            <button
              className="icon-btn"
              title="Reset curve"
              aria-label="Reset curve"
              onClick={() => s.styleConnectors(bentIds, { bend: null })}
            >
              <Icons.resetCurve />
            </button>
          )}
          {selConns.length === 1 && (
            <button
              className={`icon-btn${selConns[0].label ? ' icon-btn--active' : ''}`}
              title={tooltip(selConns[0].label ? 'Edit label' : 'Add label', ['Enter'])}
              aria-label={selConns[0].label ? 'Edit label' : 'Add label'}
              onClick={() => s.startEditing(selConns[0].id)}
            >
              <Icons.text />
            </button>
          )}
          {labeled.length > 0 && (
            <>
              <select
                className="font-size"
                value={labelSize ?? ''}
                title="Label text size"
                aria-label="Label text size"
                onChange={(e) => {
                  s.styleConnectors(labeledIds, { labelSize: Number(e.target.value) });
                  // Hand keyboard shortcuts back to the board.
                  e.currentTarget.blur();
                }}
              >
                {labelSize === null && <option value="">–</option>}
                {sizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <div className="text-color">
                <button
                  className={`icon-btn${colorsOpen ? ' icon-btn--active' : ''}`}
                  title="Label text color"
                  aria-label="Label text color"
                  aria-expanded={colorsOpen}
                  onClick={() => setColorsOpen((o) => !o)}
                >
                  <span className="text-color__glyph">
                    A
                    <span className="text-color__bar" style={{ background: labelColor }} />
                  </span>
                </button>
                {colorsOpen && (
                  <div className="text-color__menu">
                    {LABEL_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`swatch${labelColor.toLowerCase() === c.toLowerCase() ? ' swatch--active' : ''}`}
                        style={{ background: c }}
                        title={c}
                        aria-label={`Label color ${c}`}
                        onClick={() => {
                          s.styleConnectors(labeledIds, { labelColor: c });
                          setColorsOpen(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="divider" />
        </>
      )}
      <div className="swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch${current?.toLowerCase() === c.toLowerCase() ? ' swatch--active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => s.setColor(ids, c)}
          />
        ))}
      </div>
      <div className="divider" />
      {selItems.length > 0 && (
        <>
          <button className="icon-btn" title="Bring to front  ]" onClick={() => s.reorder(ids, 'front')}>
            <Icons.front />
          </button>
          <button className="icon-btn" title="Send to back  [" onClick={() => s.reorder(ids, 'back')}>
            <Icons.back />
          </button>
        </>
      )}
      <button className="icon-btn" title="Duplicate  Ctrl+D" onClick={() => s.duplicate(ids)}>
        <Icons.copy />
      </button>
      <button className="icon-btn" title="Delete  Del" onClick={() => s.deleteItems(ids)}>
        <Icons.trash />
      </button>
    </div>
  );
}
