import { useBoard } from '../store';
import { PALETTE } from '../colors';
import { Icons } from './Icons';

type ScreenBox = { left: number; top: number; width: number; height: number };

/** Floating toolbar above the current selection. */
export function ContextToolbar({ box, ids }: { box: ScreenBox; ids: string[] }) {
  const s = useBoard.getState();
  const first = useBoard((st) => st.items[ids[0]]);
  const current = first ? (first.type === 'text' ? first.color : first.fill) : null;

  // Flip below the selection when there is no room above it.
  const above = box.top > 70;
  const style = {
    left: box.left + box.width / 2,
    top: above ? box.top - 14 : box.top + box.height + 14,
    transform: `translate(-50%, ${above ? '-100%' : '0'})`,
  };

  return (
    <div className="context-toolbar" style={style} data-ui onPointerDown={(e) => e.stopPropagation()}>
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
      <button className="icon-btn" title="Bring to front  ]" onClick={() => s.reorder(ids, 'front')}>
        <Icons.front />
      </button>
      <button className="icon-btn" title="Send to back  [" onClick={() => s.reorder(ids, 'back')}>
        <Icons.back />
      </button>
      <button className="icon-btn" title="Duplicate  Ctrl+D" onClick={() => s.duplicate(ids)}>
        <Icons.copy />
      </button>
      <button className="icon-btn" title="Delete  Del" onClick={() => s.deleteItems(ids)}>
        <Icons.trash />
      </button>
    </div>
  );
}
