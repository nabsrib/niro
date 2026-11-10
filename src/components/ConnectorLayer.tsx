import { memo } from 'react';
import { useBoard } from '../store';
import { connectorGeometry } from '../connectors';
import type { Item } from '../types';

/** SVG layer in world space that draws every connector above the items. */
export function ConnectorLayer() {
  const connectors = useBoard((s) => s.connectors);
  return (
    <svg className="connectors" width="1" height="1" aria-hidden="true">
      {Object.keys(connectors).map((id) => (
        <ConnectorView key={id} id={id} />
      ))}
    </svg>
  );
}

const ConnectorView = memo(function ConnectorView({ id }: { id: string }) {
  const c = useBoard((s) => s.connectors[id]);
  // Subscribe only to the items this connector is attached to.
  const fromItem = useBoard((s) => (c?.from.kind === 'item' ? s.items[c.from.itemId] : undefined));
  const toItem = useBoard((s) => (c?.to.kind === 'item' ? s.items[c.to.itemId] : undefined));
  const selected = useBoard((s) => s.selected.includes(id));
  if (!c) return null;

  const items: Record<string, Item | undefined> = {};
  if (fromItem) items[fromItem.id] = fromItem;
  if (toItem) items[toItem.id] = toItem;
  const g = connectorGeometry(c, items);
  if (!g) return null;

  return (
    <g data-connector-id={id}>
      {selected && (
        <path d={g.d} className="connector__selection" strokeWidth={c.strokeWidth + 6} />
      )}
      <path
        d={g.d}
        fill="none"
        stroke={c.stroke}
        strokeWidth={c.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {g.startHead && <path d={g.startHead} fill={c.stroke} stroke={c.stroke} strokeLinejoin="round" />}
      {g.endHead && <path d={g.endHead} fill={c.stroke} stroke={c.stroke} strokeLinejoin="round" />}
      {/* Wide invisible stroke so thin lines are easy to click at any zoom. */}
      <path d={g.d} className="connector__hit" />
    </g>
  );
});
