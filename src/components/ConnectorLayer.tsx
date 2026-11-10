import { memo, useLayoutEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { LABEL_DEFAULTS, connectorGeometry, pointAlong } from '../connectors';
import type { Item } from '../types';
import { TextEditor } from './ItemView';

/** Room the label's foreignObject gives the text, in multiples of the font size; the label centers inside it. */
const LABEL_BOX = { w: 30, h: 20 };
/** Gap (world units) cut out of the line around the label text. */
const LABEL_PAD = 4;

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
  const editing = useBoard((s) => s.editingId === id);
  const showLabel = !!c?.label || editing;

  // Measure the label so the line can be cut where the text sits.
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelSize, setLabelSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!showLabel || !el) {
      setLabelSize(null);
      return;
    }
    const measure = () =>
      setLabelSize((prev) =>
        prev && prev.w === el.offsetWidth && prev.h === el.offsetHeight
          ? prev
          : { w: el.offsetWidth, h: el.offsetHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showLabel]);

  if (!c) return null;

  const items: Record<string, Item | undefined> = {};
  if (fromItem) items[fromItem.id] = fromItem;
  if (toItem) items[toItem.id] = toItem;
  const g = connectorGeometry(c, items);
  if (!g) return null;

  const at = showLabel ? pointAlong(g.samples, c.labelAt ?? 0.5) : null;
  const maskId = `connector-label-${id}`;
  const mask = at && labelSize ? `url(#${maskId})` : undefined;
  const margin = c.strokeWidth * 2 + 20;
  const fontSize = c.labelSize ?? LABEL_DEFAULTS.size;
  const box = { w: LABEL_BOX.w * fontSize, h: LABEL_BOX.h * fontSize };

  return (
    <g data-connector-id={id}>
      {at && labelSize && (
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={g.bounds.x - margin}
          y={g.bounds.y - margin}
          width={g.bounds.w + margin * 2}
          height={g.bounds.h + margin * 2}
        >
          <rect
            x={g.bounds.x - margin}
            y={g.bounds.y - margin}
            width={g.bounds.w + margin * 2}
            height={g.bounds.h + margin * 2}
            fill="white"
          />
          <rect
            x={at.x - labelSize.w / 2 - LABEL_PAD}
            y={at.y - labelSize.h / 2 - LABEL_PAD / 2}
            width={labelSize.w + LABEL_PAD * 2}
            height={labelSize.h + LABEL_PAD}
            rx={4}
            fill="black"
          />
        </mask>
      )}
      {selected && (
        <path d={g.d} className="connector__selection" strokeWidth={c.strokeWidth + 6} mask={mask} />
      )}
      <path
        d={g.d}
        fill="none"
        stroke={c.stroke}
        strokeWidth={c.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        mask={mask}
      />
      {g.startHead && <path d={g.startHead} fill={c.stroke} stroke={c.stroke} strokeLinejoin="round" />}
      {g.endHead && <path d={g.endHead} fill={c.stroke} stroke={c.stroke} strokeLinejoin="round" />}
      {/* Wide invisible stroke so thin lines are easy to click at any zoom. */}
      <path d={g.d} className="connector__hit" />
      {at && (
        <foreignObject
          className="connector__label-box"
          x={at.x - box.w / 2}
          y={at.y - box.h / 2}
          width={box.w}
          height={box.h}
        >
          <div className="connector__label-wrap">
            <div
              ref={labelRef}
              className={`connector__label${selected ? ' connector__label--selected' : ''}`}
              data-label-of={id}
              style={{ fontSize, color: c.labelColor ?? LABEL_DEFAULTS.color }}
              title={editing ? undefined : 'Drag to move along the line, double-click to edit'}
            >
              {editing ? (
                <TextEditor id={id} initial={c.label ?? ''} placeholder="Label" className="connector__label-text" />
              ) : (
                <div className="connector__label-text">{c.label}</div>
              )}
            </div>
          </div>
        </foreignObject>
      )}
    </g>
  );
});
