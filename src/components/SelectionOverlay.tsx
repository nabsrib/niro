import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { HANDLES, boundsOf, worldToScreen } from '../geometry';
import { SIDES, connectorGeometry, sidePoint } from '../connectors';
import { OPPOSITE, canQuickCreate, quickCreateBox } from '../quickCreate';
import type { Box, Camera, Item, Side, Vec } from '../types';
import { ContextToolbar } from './ContextToolbar';

const toScreen = (b: Box, c: Camera) => ({
  left: b.x * c.z + c.x,
  top: b.y * c.z + c.y,
  width: b.w * c.z,
  height: b.h * c.z,
});

/** Screen-space distance of the "drag to connect" dots from an item's sides. */
const DOT_OFFSET = 18;
const SIDE_OFFSET: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: -DOT_OFFSET },
  right: { x: DOT_OFFSET, y: 0 },
  bottom: { x: 0, y: DOT_OFFSET },
  left: { x: -DOT_OFFSET, y: 0 },
};

/**
 * Screen-space chrome for the current selection: outline, resize handles,
 * connect dots, connector end handles, attach hints and the context toolbar.
 */
export function SelectionOverlay() {
  const selected = useBoard((s) => s.selected);
  const items = useBoard((s) => s.items);
  const connectors = useBoard((s) => s.connectors);
  const order = useBoard((s) => s.order);
  const camera = useBoard((s) => s.camera);
  const editingId = useBoard((s) => s.editingId);
  const interacting = useBoard((s) => s.interacting);
  const hint = useBoard((s) => s.connectHint);
  const guides = useBoard((s) => s.guides);

  const selItems = selected.map((id) => items[id]).filter(Boolean);
  const selConnectors = selected.map((id) => connectors[id]).filter(Boolean);
  const geos = selConnectors.map((c) => connectorGeometry(c, items)).filter((g) => !!g);
  const itemBounds = boundsOf(selItems);
  const allBounds = boundsOf([...selItems, ...geos.map((g) => g.bounds)]);
  const hintItem = hint ? items[hint.itemId] : undefined;

  // Frames (containers) and pen strokes get no "drag to connect" dots.
  const single =
    selItems.length === 1 &&
    selConnectors.length === 0 &&
    selItems[0].type !== 'frame' &&
    selItems[0].type !== 'path'
      ? selItems[0]
      : null;
  const singleConn = selConnectors.length === 1 && selItems.length === 0 ? selConnectors[0] : null;
  const singleGeo = singleConn ? geos[0] : null;
  const idle = !interacting && !editingId;

  // Which connect dot the pointer is over, for the quick-create preview.
  const [hoverSide, setHoverSide] = useState<Side | null>(null);
  const singleId = single?.id;
  useEffect(() => setHoverSide(null), [singleId, interacting, editingId]);
  const ghostSide = single && idle && canQuickCreate(single) ? hoverSide : null;

  return (
    <>
      {hintItem && (
        <div className="attach-target" style={toScreen(hintItem, camera)}>
          {SIDES.map((side) => {
            const p = worldToScreen(sidePoint(hintItem, side), camera);
            const box = toScreen(hintItem, camera);
            return (
              <div
                key={side}
                className={`attach-dot${hint?.side === side ? ' attach-dot--active' : ''}`}
                style={{ left: p.x - box.left, top: p.y - box.top }}
              />
            );
          })}
        </div>
      )}

      {selItems.length + selConnectors.length > 1 &&
        selItems.map((it) => <div key={it.id} className="sel-item" style={toScreen(it, camera)} />)}

      {itemBounds && (
        <div className="sel-box" style={toScreen(itemBounds, camera)}>
          {!editingId &&
            Object.keys(HANDLES).map((h) => (
              <div key={h} data-handle={h} className={`handle handle--${h}`} />
            ))}
        </div>
      )}

      {single &&
        idle &&
        SIDES.map((side) => {
          const p = worldToScreen(sidePoint(single, side), camera);
          return (
            <div
              key={side}
              className="connect-dot"
              title={
                canQuickCreate(single)
                  ? 'Click to add a connected copy · drag to draw a connector'
                  : 'Drag to draw a connector'
              }
              data-connect-side={side}
              data-connect-item={single.id}
              style={{ left: p.x + SIDE_OFFSET[side].x, top: p.y + SIDE_OFFSET[side].y }}
              onPointerEnter={() => setHoverSide(side)}
              onPointerLeave={() => setHoverSide((cur) => (cur === side ? null : cur))}
            />
          );
        })}

      {single && ghostSide && (
        <QuickCreateGhost
          src={single}
          side={ghostSide}
          box={quickCreateBox(single, ghostSide, items, order)}
          camera={camera}
        />
      )}

      {singleConn && singleGeo && !editingId &&
        (['from', 'to'] as const).map((end) => {
          const p = worldToScreen(end === 'from' ? singleGeo.a : singleGeo.b, camera);
          const attached = singleConn[end].kind === 'item';
          return (
            <div
              key={end}
              className={`end-handle${attached ? ' end-handle--attached' : ''}`}
              data-endpoint={end}
              data-endpoint-of={singleConn.id}
              style={{ left: p.x, top: p.y }}
            />
          );
        })}

      {singleConn && singleGeo && singleConn.style === 'curved' && !editingId && (() => {
        const p = worldToScreen(singleGeo.mid, camera);
        return (
          <div
            className={`bend-handle${singleConn.bend ? ' bend-handle--set' : ''}`}
            data-bend-of={singleConn.id}
            title="Drag to shape the curve · double-click to reset"
            style={{ left: p.x, top: p.y }}
          />
        );
      })()}

      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <div
            key={i}
            className="guide"
            style={{
              left: g.at * camera.z + camera.x,
              top: g.from * camera.z + camera.y,
              width: 1,
              height: (g.to - g.from) * camera.z,
            }}
          />
        ) : (
          <div
            key={i}
            className="guide"
            style={{
              left: g.from * camera.z + camera.x,
              top: g.at * camera.z + camera.y,
              width: (g.to - g.from) * camera.z,
              height: 1,
            }}
          />
        ),
      )}

      {allBounds && idle && <ContextToolbar box={toScreen(allBounds, camera)} ids={selected} />}
    </>
  );
}

/** Dimmed preview of the copy (and arrow) a click on a connect dot would create. */
function QuickCreateGhost({ src, side, box, camera }: { src: Item; side: Side; box: Box; camera: Camera }) {
  const from = worldToScreen(sidePoint(src, side), camera);
  const to = worldToScreen(sidePoint(box, OPPOSITE[side]), camera);
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const u: Vec = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  const head = 10;
  const base = { x: to.x - u.x * head, y: to.y - u.y * head };
  const n = { x: -u.y * head * 0.5, y: u.x * head * 0.5 };
  const shape = src.type === 'ellipse' ? ' quick-ghost--ellipse' : '';
  return (
    <>
      <div
        className={`quick-ghost${shape}`}
        style={{ ...toScreen(box, camera), background: src.fill }}
      />
      <svg className="quick-ghost__arrow">
        <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} />
        <path d={`M ${to.x} ${to.y} L ${base.x + n.x} ${base.y + n.y} L ${base.x - n.x} ${base.y - n.y} Z`} />
      </svg>
    </>
  );
}
