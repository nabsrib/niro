import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useBoard } from '../store';
import type { Box, Camera, Item, ItemType, Vec } from '../types';
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
import { ITEM_DEFAULTS, makeItem } from '../defaults';
import { ItemView } from './ItemView';
import { SelectionOverlay } from './SelectionOverlay';

/** Screen pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

type Gesture =
  | { kind: 'pan'; startScreen: Vec; startCam: Camera }
  | {
      kind: 'move';
      startScreen: Vec;
      startWorld: Vec;
      origin: Record<string, Vec>;
      moved: boolean;
      /** On a click without drag inside a multi-selection, narrow to this item. */
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
  | { kind: 'create'; startScreen: Vec; startWorld: Vec; id: string; type: ItemType; dragged: boolean };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

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
    const target = e.target as HTMLElement;
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
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    if (handle && s.selected.length) {
      const sel = s.selected.map((id) => s.items[id]).filter(Boolean);
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

    // Select / move.
    const hitId = target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId ?? null;
    const selBounds =
      s.selected.length > 1 ? boundsOf(s.selected.map((id) => s.items[id]).filter(Boolean)) : null;
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
      for (const id of selected) {
        const it = s.items[id];
        if (it) origin[id] = { x: it.x, y: it.y };
      }
      begin(e, { kind: 'move', startScreen: screen, startWorld: world, origin, moved: false, collapseTo });
      return;
    }

    // Empty canvas: marquee selection.
    const base = e.shiftKey ? s.selected : [];
    if (!e.shiftKey) s.setSelected([]);
    begin(e, { kind: 'marquee', startWorld: world, base });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const s = useBoard.getState();
    const screen = local(e);
    const world = screenToWorld(screen, s.camera);

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
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-editor], [data-ui]')) return;
    const s = useBoard.getState();
    const id = target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
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
      : isCreationTool(tool)
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

/** World layer: every item lives here; the camera is one CSS transform. */
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
    </div>
  );
}
