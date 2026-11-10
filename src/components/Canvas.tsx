import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useBoard } from '../store';
import type { Box, Camera, Endpoint, Item, ItemType, Side, Vec } from '../types';
import { isCreationTool } from '../types';
import {
  HANDLES,
  MIN_ITEM_SIZE,
  boundsOf,
  containsPoint,
  intersects,
  normalizeRect,
  resizeBox,
  screenToWorld,
} from '../geometry';
import { connectorGeometry, endpointAt, endpointItem, makeConnector } from '../connectors';
import { ITEM_DEFAULTS, makeItem } from '../defaults';
import { ItemView } from './ItemView';
import { ConnectorLayer } from './ConnectorLayer';
import { SelectionOverlay } from './SelectionOverlay';

/** Screen pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

type FreeEnds = { from?: Vec; to?: Vec };

type Gesture =
  | { kind: 'pan'; startScreen: Vec; startCam: Camera }
  | {
      kind: 'move';
      startScreen: Vec;
      startWorld: Vec;
      origin: Record<string, Vec>;
      /** Free (unattached) connector ends that travel with the selection. */
      freeEnds: Record<string, FreeEnds>;
      moved: boolean;
      /** On a click without drag inside a multi-selection, narrow to this id. */
      collapseTo: string | null;
    }
  | { kind: 'marquee'; startWorld: Vec; base: string[] }
  | {
      kind: 'resize';
      startWorld: Vec;
      dir: Vec;
      bounds: Box;
      origin: Record<string, Item>;
      moved: boolean;
    }
  | { kind: 'create'; startScreen: Vec; startWorld: Vec; id: string; type: ItemType; dragged: boolean }
  /** Drawing a new connector; it is only created once the pointer has moved. */
  | { kind: 'connect'; startScreen: Vec; from: Endpoint; id: string | null }
  /** Dragging one end of an existing connector. */
  | { kind: 'reconnect'; id: string; end: 'from' | 'to'; moved: boolean };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const attr = (target: Element, name: string) => target.closest(`[${name}]`)?.getAttribute(name) ?? null;

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [panning, setPanning] = useState(false);
  const tool = useBoard((s) => s.tool);
  const spaceHeld = useBoard((s) => s.spaceHeld);
  const camera = useBoard((s) => s.camera);

  // Track viewport size (used by zoom buttons / zoom-to-fit).
  useEffect(() => {
    const el = ref.current!;
    const measure = () => useBoard.getState().setViewport(el.clientWidth, el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Wheel: pan by default, zoom with Ctrl/Cmd (trackpad pinch also sends ctrlKey).
  // Registered natively because React wheel listeners are passive.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useBoard.getState();
      const r = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const d = Math.max(-10, Math.min(10, dy));
        s.zoomAt({ x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-d * 0.01));
      } else {
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        s.panBy(-dx, -dy);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const begin = (e: ReactPointerEvent, g: Gesture) => {
    ref.current!.setPointerCapture(e.pointerId);
    gesture.current = g;
    if (g.kind !== 'pan') useBoard.getState().setInteracting(true);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest('[data-editor], [data-ui]')) return;
    const s = useBoard.getState();
    if (s.editingId) (document.activeElement as HTMLElement | null)?.blur();

    const screen = local(e);
    const world = screenToWorld(screen, s.camera);

    // Pan: middle mouse, hand tool, or space + drag.
    if (e.button === 1 || (e.button === 0 && (s.tool === 'hand' || s.spaceHeld))) {
      e.preventDefault();
      begin(e, { kind: 'pan', startScreen: screen, startCam: s.camera });
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    // Resize via a selection handle.
    const handle = attr(target, 'data-handle');
    if (handle && s.selected.length) {
      const sel = s.selected.map((id) => s.items[id]).filter(Boolean);
      if (sel.length) {
        begin(e, {
          kind: 'resize',
          startWorld: world,
          dir: HANDLES[handle],
          bounds: boundsOf(sel)!,
          origin: Object.fromEntries(sel.map((it) => [it.id, it])),
          moved: false,
        });
        return;
      }
    }

    // Drag out a connector from one of the side dots of the selected item.
    const side = attr(target, 'data-connect-side') as Side | null;
    const sourceId = attr(target, 'data-connect-item');
    if (side && sourceId) {
      begin(e, { kind: 'connect', startScreen: screen, from: { kind: 'item', itemId: sourceId, side }, id: null });
      return;
    }

    // Drag an end of the selected connector to re-attach it.
    const end = attr(target, 'data-endpoint') as 'from' | 'to' | null;
    const endOf = attr(target, 'data-endpoint-of');
    if (end && endOf) {
      begin(e, { kind: 'reconnect', id: endOf, end, moved: false });
      return;
    }

    // Connector tool: start from the item under the pointer, or from empty canvas.
    if (s.tool === 'connector') {
      const from = endpointAt(world, s.items, s.order, s.camera.z);
      begin(e, { kind: 'connect', startScreen: screen, from, id: null });
      return;
    }

    // Create a new item.
    if (isCreationTool(s.tool)) {
      const item = makeItem(s.tool, world.x, world.y);
      s.addItem(item);
      s.setSelected([item.id]);
      begin(e, {
        kind: 'create',
        startScreen: screen,
        startWorld: world,
        id: item.id,
        type: item.type,
        dragged: false,
      });
      return;
    }

    // Select / move items and connectors.
    const hitId = attr(target, 'data-item-id') ?? attr(target, 'data-connector-id');
    const selItems = s.selected.map((id) => s.items[id]).filter(Boolean);
    const selBounds = s.selected.length > 1 ? boundsOf(selItems) : null;
    const inSelection = !!selBounds && containsPoint(selBounds, world) && !e.shiftKey;

    if (hitId || inSelection) {
      let selected = s.selected;
      let collapseTo: string | null = null;
      if (hitId) {
        const already = selected.includes(hitId);
        if (e.shiftKey) {
          selected = already ? selected.filter((id) => id !== hitId) : [...selected, hitId];
          s.setSelected(selected);
          if (already) return;
        } else if (!already) {
          selected = [hitId];
          s.setSelected(selected);
        } else if (selected.length > 1) {
          collapseTo = hitId;
        }
      }
      const origin: Record<string, Vec> = {};
      const freeEnds: Record<string, FreeEnds> = {};
      for (const id of selected) {
        const it = s.items[id];
        if (it) origin[id] = { x: it.x, y: it.y };
        const c = s.connectors[id];
        if (c) {
          freeEnds[id] = {
            from: c.from.kind === 'point' ? { x: c.from.x, y: c.from.y } : undefined,
            to: c.to.kind === 'point' ? { x: c.to.x, y: c.to.y } : undefined,
          };
        }
      }
      begin(e, {
        kind: 'move',
        startScreen: screen,
        startWorld: world,
        origin,
        freeEnds,
        moved: false,
        collapseTo,
      });
      return;
    }

    // Empty canvas: marquee selection.
    const base = e.shiftKey ? s.selected : [];
    if (!e.shiftKey) s.setSelected([]);
    begin(e, { kind: 'marquee', startWorld: world, base });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const s = useBoard.getState();
    const screen = local(e);
    const world = screenToWorld(screen, s.camera);

    if (!g) {
      // Hover feedback for the connector tool: highlight the item we'd attach to.
      if (s.tool === 'connector') {
        const ep = endpointAt(world, s.items, s.order, s.camera.z);
        s.setConnectHint(ep.kind === 'item' ? { itemId: ep.itemId, side: ep.side } : null);
      }
      return;
    }

    switch (g.kind) {
      case 'pan': {
        s.setCamera({
          ...g.startCam,
          x: g.startCam.x + screen.x - g.startScreen.x,
          y: g.startCam.y + screen.y - g.startScreen.y,
        });
        break;
      }
      case 'move': {
        if (!g.moved) {
          if (dist(screen, g.startScreen) < DRAG_THRESHOLD) return;
          g.moved = true;
          s.checkpoint();
        }
        const dx = world.x - g.startWorld.x;
        const dy = world.y - g.startWorld.y;
        const patches: Record<string, Partial<Item>> = {};
        for (const id in g.origin) patches[id] = { x: g.origin[id].x + dx, y: g.origin[id].y + dy };
        s.updateItems(patches);
        for (const id in g.freeEnds) {
          const { from, to } = g.freeEnds[id];
          const patch: { from?: Endpoint; to?: Endpoint } = {};
          if (from) patch.from = { kind: 'point', x: from.x + dx, y: from.y + dy };
          if (to) patch.to = { kind: 'point', x: to.x + dx, y: to.y + dy };
          if (patch.from || patch.to) s.updateConnector(id, patch);
        }
        break;
      }
      case 'resize': {
        if (!g.moved) {
          g.moved = true;
          s.checkpoint();
        }
        const origins = Object.values(g.origin);
        const corner = g.dir.x !== 0 && g.dir.y !== 0;
        const lock =
          e.shiftKey ||
          origins.length > 1 ||
          origins.some((o) => o.type === 'sticky') ||
          (corner && origins.some((o) => o.type === 'text'));
        const b = g.bounds;
        const nb = resizeBox(
          b,
          g.dir,
          { x: world.x - g.startWorld.x, y: world.y - g.startWorld.y },
          lock,
        );
        const sx = nb.w / b.w;
        const sy = nb.h / b.h;
        const patches: Record<string, Partial<Item>> = {};
        for (const o of origins) {
          patches[o.id] = {
            x: nb.x + (o.x - b.x) * sx,
            y: nb.y + (o.y - b.y) * sy,
            w: o.w * sx,
            h: o.h * sy,
            fontSize: lock ? o.fontSize * sx : o.fontSize,
          };
        }
        s.updateItems(patches);
        break;
      }
      case 'marquee': {
        const rect = normalizeRect(g.startWorld, world);
        setMarquee(rect);
        const hits = s.order.filter((id) => intersects(s.items[id], rect));
        for (const c of Object.values(s.connectors)) {
          const geo = connectorGeometry(c, s.items);
          if (geo?.samples.some((p) => containsPoint(rect, p))) hits.push(c.id);
        }
        const next = Array.from(new Set([...g.base, ...hits]));
        if (next.length !== s.selected.length || next.some((id, i) => id !== s.selected[i])) {
          s.setSelected(next);
        }
        break;
      }
      case 'create': {
        if (!g.dragged) {
          if (dist(screen, g.startScreen) < DRAG_THRESHOLD) return;
          g.dragged = true;
        }
        let r = normalizeRect(g.startWorld, world);
        const patch: Partial<Item> = {};
        if (g.type === 'sticky') {
          const size = Math.max(r.w, r.h, MIN_ITEM_SIZE);
          r = {
            x: world.x < g.startWorld.x ? g.startWorld.x - size : g.startWorld.x,
            y: world.y < g.startWorld.y ? g.startWorld.y - size : g.startWorld.y,
            w: size,
            h: size,
          };
          patch.fontSize = (ITEM_DEFAULTS.sticky.fontSize * size) / ITEM_DEFAULTS.sticky.w;
        }
        s.updateItems({
          [g.id]: {
            ...patch,
            ...r,
            w: Math.max(r.w, MIN_ITEM_SIZE),
            h: Math.max(r.h, MIN_ITEM_SIZE),
          },
        });
        break;
      }
      case 'connect': {
        if (!g.id) {
          if (dist(screen, g.startScreen) < DRAG_THRESHOLD) return;
          const c = makeConnector(g.from, { kind: 'point', x: world.x, y: world.y });
          s.addConnector(c);
          s.setSelected([]);
          g.id = c.id;
        }
        const to = endpointAt(world, s.items, s.order, s.camera.z, endpointItem(g.from));
        s.updateConnector(g.id, { to });
        s.setConnectHint(to.kind === 'item' ? { itemId: to.itemId, side: to.side } : null);
        break;
      }
      case 'reconnect': {
        const c = s.connectors[g.id];
        if (!c) return;
        if (!g.moved) {
          g.moved = true;
          s.checkpoint();
        }
        const other = g.end === 'from' ? c.to : c.from;
        const ep = endpointAt(world, s.items, s.order, s.camera.z, endpointItem(other));
        s.updateConnector(g.id, { [g.end]: ep });
        s.setConnectHint(ep.kind === 'item' ? { itemId: ep.itemId, side: ep.side } : null);
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    const s = useBoard.getState();
    s.setInteracting(false);

    switch (g.kind) {
      case 'pan':
        setPanning(false);
        break;
      case 'move':
        if (!g.moved && g.collapseTo) s.setSelected([g.collapseTo]);
        break;
      case 'marquee':
        setMarquee(null);
        break;
      case 'create': {
        const item = s.items[g.id];
        if (g.dragged && item && item.w < 20 && item.h < 20) {
          // Accidental tiny drag: fall back to the default size.
          const d = makeItem(g.type, g.startWorld.x, g.startWorld.y);
          s.updateItems({ [g.id]: { x: d.x, y: d.y, w: d.w, h: d.h, fontSize: d.fontSize } });
        }
        s.setTool('select');
        s.setSelected([g.id]);
        if (g.type === 'sticky' || g.type === 'text') s.startEditing(g.id);
        break;
      }
      case 'connect':
        s.setConnectHint(null);
        if (g.id) {
          s.setTool('select');
          s.setSelected([g.id]);
        }
        break;
      case 'reconnect':
        s.setConnectHint(null);
        break;
    }
  };

  const onPointerLeave = () => {
    if (!gesture.current) useBoard.getState().setConnectHint(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('[data-editor], [data-ui]')) return;
    const s = useBoard.getState();
    const id = attr(target, 'data-item-id');
    if (id && s.tool === 'select') s.startEditing(id);
  };

  // Dotted grid that scales with zoom; the step snaps by 5x to stay readable.
  let step = 20 * camera.z;
  while (step < 12) step *= 5;
  while (step > 120) step /= 5;

  const cursor = panning
    ? 'grabbing'
    : tool === 'hand' || spaceHeld
      ? 'grab'
      : isCreationTool(tool) || tool === 'connector'
        ? 'crosshair'
        : 'default';

  return (
    <div
      ref={ref}
      className="viewport"
      style={{
        cursor,
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <World />
      <div className="overlay">
        <SelectionOverlay />
        {marquee && (
          <div
            className="marquee"
            style={{
              left: marquee.x * camera.z + camera.x,
              top: marquee.y * camera.z + camera.y,
              width: marquee.w * camera.z,
              height: marquee.h * camera.z,
            }}
          />
        )}
      </div>
    </div>
  );
}

/** World layer: items and connectors live here; the camera is one CSS transform. */
function World() {
  const camera = useBoard((s) => s.camera);
  const order = useBoard((s) => s.order);
  return (
    <div
      className="world"
      style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}
    >
      {order.map((id) => (
        <ItemView key={id} id={id} />
      ))}
      <ConnectorLayer />
    </div>
  );
}
