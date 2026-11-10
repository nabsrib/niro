import { useBoard } from '../store';
import { PALETTE } from '../colors';
import type { ConnectorStyle } from '../types';
import { Icons } from './Icons';

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
