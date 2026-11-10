import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
import {
  bendFromPoint,
  connectorGeometry,
  endpointAt,
  endpointItem,
  fractionAlong,
  makeConnector,
  resolveConnector,
} from '../connectors';
import { ITEM_DEFAULTS, makeItem } from '../defaults';
import { FRAME_PRESETS, deckInsertion, deckSlides, isDeck, isFrame, renderOrder, withFrameChildren } from '../frames';
import { SNAP_DISTANCE, alignmentGuides, snapMove, snapValue } from '../snapping';
import type { BoardState } from '../store';
import { ItemView } from './ItemView';
import { commitActiveEdit } from '../editing';
import { importBoardFile } from '../boardActions';
import { eraseStroke, makePathItem, simplify, smoothPath } from '../pen';
import { ConnectorLayer } from './ConnectorLayer';
import { SelectionOverlay } from './SelectionOverlay';
import { DeckControls } from './DeckControls';

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
      /** Bounds of the moving items at the start (null if only connectors move). */
      bounds: Box | null;
      /** Items to snap against. */
      targets: Box[];
    }
  | { kind: 'marquee'; startWorld: Vec; base: string[] }
  | {
      kind: 'resize';
      startWorld: Vec;
      dir: Vec;
      bounds: Box;
      origin: Record<string, Item>;
      moved: boolean;
      targets: Box[];
    }
  | { kind: 'create'; startScreen: Vec; startWorld: Vec; id: string; type: ItemType; dragged: boolean }
  /** Drawing a new connector; it is only created once the pointer has moved. */
  | {
      kind: 'connect';
      startScreen: Vec;
      from: Endpoint;
      id: string | null;
      /** Started on a connect dot: a click without dragging adds a connected copy. */
      quick?: { itemId: string; side: Side };
    }
  /** Dragging one end of an existing connector. */
  | { kind: 'reconnect'; id: string; end: 'from' | 'to'; moved: boolean }
  /** Dragging the middle handle of a curved connector to reshape it. */
  | { kind: 'bend'; id: string; moved: boolean }
  /** Dragging a connector's label along its line. */
  | { kind: 'label'; id: string; startScreen: Vec; moved: boolean }
  /** Freehand pen stroke; points are in world coordinates. */
  | { kind: 'draw'; points: Vec[]; color: string; width: number; highlight: boolean }
  /** Eraser drag: cuts away the parts of pen strokes it passes over. `last` is in world coordinates. */
  | { kind: 'erase'; last: Vec; started: boolean };

/**
 * Sweep the eraser from its last point to `to`, cutting the covered parts out of
 * pen strokes (splitting them where needed). The first cut records one undo step
 * for the whole drag.
 */
function eraseTo(g: Extract<Gesture, { kind: 'erase' }>, to: Vec, s: BoardState) {
  const radius = s.eraser.size / 2 / s.camera.z;
  const tolerance = 0.4 / s.camera.z;
  const changes: Record<string, Item[]> = {};
  let changed = false;
  for (const id of s.order) {
    const it = s.items[id];
    const pieces = it && eraseStroke(it, g.last, to, radius, tolerance);
    if (pieces) {
      changes[id] = pieces;
      changed = true;
    }
  }
  g.last = to;
  if (!changed) return;
  if (!g.started) {
    g.started = true;
    s.checkpoint();
  }
  s.replaceItems(changes);
}

/** Circle cursor as big as the eraser (in screen pixels). */
function eraserCursor(size: number): string {
  const box = size + 4;
  const c = box / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${box}' height='${box}'>` +
    `<circle cx='${c}' cy='${c}' r='${size / 2}' fill='white' fill-opacity='0.6' stroke='#1a1a1a' stroke-width='1.5'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
}

/** Two presses on the curve handle within this many ms reset the curve. */
const DOUBLE_PRESS_MS = 350;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const attr = (target: Element, name: string) => target.closest(`[${name}]`)?.getAttribute(name) ?? null;
const shift = (b: Box, d: Vec): Box => ({ ...b, x: b.x + d.x, y: b.y + d.y });
const containsBox = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/** Items on screen (minus `exclude`) that moving/resizing items can snap to. */
function snapTargets(s: BoardState, exclude: Set<string>): Box[] {
  const { camera: c, viewport: v } = s;
  const margin = 200 / c.z;
  const view = {
    x: -c.x / c.z - margin,
    y: -c.y / c.z - margin,
    w: v.w / c.z + margin * 2,
    h: v.h / c.z + margin * 2,
  };
  return s.order
    .filter((id) => !exclude.has(id))
    .map((id) => s.items[id])
    .filter((it) => it && intersects(it, view));
}

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastBendPress = useRef<{ id: string; time: number } | null>(null);
  // Last press on a connector or its label, to spot a double press (opens the
  // label editor on release; pointer capture retargets the dblclick event).
  const lastConnectorPress = useRef<{ id: string; time: number } | null>(null);
  const editOnRelease = useRef<string | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [panning, setPanning] = useState(false);
  const [dropping, setDropping] = useState(false);
  // Live pen stroke (world points); a version counter re-renders the preview
  // without copying the growing point list on every move.
  const [strokeVersion, setStrokeVersion] = useState(0);
  const tool = useBoard((s) => s.tool);
  const erasing = useBoard((s) => s.tool === 'pen' && s.penMode === 'eraser');
  const eraserSize = useBoard((s) => s.eraser.size);
  const presenting = useBoard((s) => s.presenting !== null);
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
      // Presenting: the camera belongs to the slides.
      if (s.presenting) return;
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
    try {
      ref.current!.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (e.g. released mid-dispatch); still run the gesture.
    }
    gesture.current = g;
    if (g.kind !== 'pan') useBoard.getState().setInteracting(true);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    if (target.closest('[data-editor], [data-ui]')) return;
    const s = useBoard.getState();
    // Presenting: the board is view-only.
    if (s.presenting) return;
    if (s.editingId) {
      commitActiveEdit();
      (document.activeElement as HTMLElement | null)?.blur();
    }

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
          targets: snapTargets(s, new Set(sel.map((it) => it.id))),
        });
        return;
      }
    }

    // Drag out a connector from one of the side dots of the selected item.
    const side = attr(target, 'data-connect-side') as Side | null;
    const sourceId = attr(target, 'data-connect-item');
    if (side && sourceId) {
      begin(e, {
        kind: 'connect',
        startScreen: screen,
        from: { kind: 'item', itemId: sourceId, side },
        id: null,
        quick: { itemId: sourceId, side },
      });
      return;
    }

    // Drag an end of the selected connector to re-attach it.
    const end = attr(target, 'data-endpoint') as 'from' | 'to' | null;
    const endOf = attr(target, 'data-endpoint-of');
    if (end && endOf) {
      begin(e, { kind: 'reconnect', id: endOf, end, moved: false });
      return;
    }

    // Drag the curve handle to bend a curved connector; double-press resets it.
    // (Detected here because pointer capture retargets the dblclick event.)
    const bendOf = attr(target, 'data-bend-of');
    if (bendOf) {
      const last = lastBendPress.current;
      const now = performance.now();
      if (last && last.id === bendOf && now - last.time < DOUBLE_PRESS_MS) {
        lastBendPress.current = null;
        s.styleConnectors([bendOf], { bend: null });
        return;
      }
      lastBendPress.current = { id: bendOf, time: now };
      begin(e, { kind: 'bend', id: bendOf, moved: false });
      return;
    }

    // Pen: start a freehand stroke. Width is in screen pixels, so strokes look
    // the same thickness whatever the zoom level was while drawing.
    // Eraser: cuts away the parts of pen and highlighter strokes it passes over.
    if (s.tool === 'pen' && s.penMode === 'eraser') {
      s.setSelected([]);
      const g: Extract<Gesture, { kind: 'erase' }> = { kind: 'erase', last: world, started: false };
      begin(e, g);
      eraseTo(g, world, s);
      return;
    }

    if (s.tool === 'pen') {
      s.setSelected([]);
      const highlight = s.penMode === 'highlighter';
      const { color, width } = highlight ? s.highlighter : s.pen;
      begin(e, { kind: 'draw', points: [world], color, width: width / s.camera.z, highlight });
      setStrokeVersion((v) => v + 1);
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
      // Frame tool, Slides preset: click creates a slide deck.
      if (s.tool === 'frame' && s.framePreset === 'slides') {
        s.createDeck(world);
        return;
      }
      const item = makeItem(s.tool, world.x, world.y);
      if (item.type === 'frame') {
        const preset = FRAME_PRESETS.find((p) => p.id === s.framePreset) ?? FRAME_PRESETS[0];
        Object.assign(item, { x: world.x - preset.w / 2, y: world.y - preset.h / 2, w: preset.w, h: preset.h });
        item.text = `Frame ${s.order.filter((id) => isFrame(s.items[id])).length + 1}`;
      }
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

    // Connectors: a double press edits the label; dragging a label slides it along the line.
    const labelOf = attr(target, 'data-label-of');
    const connectorHit = labelOf ?? attr(target, 'data-connector-id');
    if (connectorHit && !e.shiftKey) {
      const last = lastConnectorPress.current;
      const now = performance.now();
      if (last && last.id === connectorHit && now - last.time < DOUBLE_PRESS_MS) {
        lastConnectorPress.current = null;
        editOnRelease.current = connectorHit;
        return;
      }
      lastConnectorPress.current = { id: connectorHit, time: now };
      if (labelOf) {
        s.setSelected([labelOf]);
        begin(e, { kind: 'label', id: labelOf, startScreen: screen, moved: false });
        return;
      }
    }

    // Select / move items and connectors.
    let hitId = attr(target, 'data-item-id') ?? attr(target, 'data-connector-id');
    // A frame is grabbed by its title. Its body behaves like canvas (so you can
    // marquee inside it), unless the frame is already selected.
    if (
      hitId &&
      isFrame(s.items[hitId]) &&
      !target.closest('[data-frame-title]') &&
      !s.selected.includes(hitId)
    ) {
      hitId = null;
    }
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
      // Frames carry their contents, including loose connector ends inside them.
      const moving = withFrameChildren(selected, s.items, s.order);
      const frames = selected.map((id) => s.items[id]).filter(isFrame);
      const origin: Record<string, Vec> = {};
      const freeEnds: Record<string, FreeEnds> = {};
      const inFrame = (p: Vec) => frames.some((f) => containsPoint(f, p));
      for (const id of moving) {
        const it = s.items[id];
        if (it) origin[id] = { x: it.x, y: it.y };
      }
      for (const c of Object.values(s.connectors)) {
        const picked = selected.includes(c.id);
        const from = c.from.kind === 'point' && (picked || inFrame(c.from)) ? { x: c.from.x, y: c.from.y } : undefined;
        const to = c.to.kind === 'point' && (picked || inFrame(c.to)) ? { x: c.to.x, y: c.to.y } : undefined;
        if (from || to) freeEnds[c.id] = { from, to };
      }
      const movingItems = moving.map((id) => s.items[id]).filter(Boolean);
      begin(e, {
        kind: 'move',
        startScreen: screen,
        startWorld: world,
        origin,
        freeEnds,
        moved: false,
        collapseTo,
        // Snap the selection itself; children of a frame just ride along.
        bounds: boundsOf(selected.map((id) => s.items[id]).filter(Boolean)),
        targets: movingItems.length ? snapTargets(s, new Set(moving)) : [],
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
        let dx = world.x - g.startWorld.x;
        let dy = world.y - g.startWorld.y;
        // Snap to aligned edges/centers or equal spacing; hold Alt to move freely.
        if (g.bounds && g.targets.length && !e.altKey) {
          const snap = snapMove(shift(g.bounds, { x: dx, y: dy }), g.targets, SNAP_DISTANCE / s.camera.z);
          dx += snap.offset.x;
          dy += snap.offset.y;
          s.setGuides(snap.guides, snap.gaps);
        } else {
          s.setGuides([]);
        }
        const patches: Record<string, Partial<Item>> = {};
        for (const id in g.origin) patches[id] = { x: g.origin[id].x + dx, y: g.origin[id].y + dy };
        s.updateItems(patches);

        // Dragging one frame over a slide deck: show where it would join the row.
        const dragged = s.selected.length === 1 ? s.items[s.selected[0]] : undefined;
        if (isFrame(dragged) && !isDeck(dragged)) {
          const st = useBoard.getState();
          const moving = new Set(Object.keys(g.origin));
          const rest = st.order.filter((id) => !moving.has(id));
          const deck = rest
            .map((id) => st.items[id])
            .filter((d) => isDeck(d) && containsPoint(d, world))
            .sort((a, b) => a.w * a.h - b.w * b.h)[0];
          if (deck) {
            const { index, line } = deckInsertion(deck, deckSlides(deck, st.items, rest), world.x);
            s.setDeckDrop({ deckId: deck.id, index, line });
          } else {
            s.setDeckDrop(null);
          }
        }
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
        const delta = { x: world.x - g.startWorld.x, y: world.y - g.startWorld.y };
        const snapping = g.targets.length > 0 && !e.altKey;
        if (snapping) {
          // Snap the edge(s) being dragged to nearby edges/centers.
          const th = SNAP_DISTANCE / s.camera.z;
          if (g.dir.x) {
            const edge = (g.dir.x < 0 ? b.x : b.x + b.w) + delta.x;
            delta.x += snapValue(edge, g.targets, 'x', th) - edge;
          }
          if (g.dir.y) {
            const edge = (g.dir.y < 0 ? b.y : b.y + b.h) + delta.y;
            delta.y += snapValue(edge, g.targets, 'y', th) - edge;
          }
        }
        const nb = resizeBox(b, g.dir, delta, lock);
        // Only show guides for what actually lines up after aspect locking.
        s.setGuides(snapping ? alignmentGuides(nb, g.targets) : []);
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
        // Frames are big backdrops: only pick them when fully enclosed.
        const hits = s.order.filter((id) => {
          const it = s.items[id];
          return isFrame(it) ? containsBox(rect, it) : intersects(it, rect);
        });
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
      case 'erase':
        eraseTo(g, world, s);
        break;
      case 'draw': {
        // Use coalesced events so fast strokes keep their detail.
        const native = e.nativeEvent;
        const events = native.getCoalescedEvents?.() ?? [];
        const r = ref.current!.getBoundingClientRect();
        const minGap = 1.5 / s.camera.z;
        let added = false;
        for (const ev of events.length ? events : [native]) {
          const p = screenToWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top }, s.camera);
          const last = g.points[g.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= minGap) {
            g.points.push(p);
            added = true;
          }
        }
        if (added) setStrokeVersion((v) => v + 1);
        break;
      }
      case 'label': {
        const c = s.connectors[g.id];
        const geo = c && connectorGeometry(c, s.items);
        if (!geo) return;
        if (!g.moved) {
          if (dist(screen, g.startScreen) < DRAG_THRESHOLD) return;
          g.moved = true;
          s.checkpoint();
        }
        s.updateConnector(g.id, { labelAt: fractionAlong(geo.samples, world) });
        break;
      }
      case 'bend': {
        const c = s.connectors[g.id];
        const r = c && resolveConnector(c, s.items);
        if (!r) return;
        if (!g.moved) {
          g.moved = true;
          s.checkpoint();
        }
        const bend = bendFromPoint(r.a, r.b, world);
        if (bend) s.updateConnector(g.id, { bend });
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
    // Open the label editor only now: focusing it on press would lose focus
    // again to the browser's own handling of that press.
    const editId = editOnRelease.current;
    if (editId) {
      editOnRelease.current = null;
      useBoard.getState().startEditing(editId);
      return;
    }
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    const s = useBoard.getState();
    s.setInteracting(false);
    s.setGuides([]);
    // A frame dropped on a slide deck joins its row where the insertion line was.
    if (g.kind === 'move' && g.moved && s.deckDrop && s.selected.length === 1) {
      s.dropIntoDeck(s.selected[0], s.deckDrop.deckId, s.deckDrop.index, Object.keys(g.origin));
    }
    s.setDeckDrop(null);
    // A frame moved, resized or drawn into (or out of) a slide deck: re-lay out the decks.
    if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'create') s.layoutDecks();

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
          // Accidental tiny drag: fall back to the default (or preset) size.
          const d = makeItem(g.type, g.startWorld.x, g.startWorld.y);
          const preset = g.type === 'frame' ? FRAME_PRESETS.find((p) => p.id === s.framePreset) : undefined;
          if (preset) Object.assign(d, { x: g.startWorld.x - preset.w / 2, y: g.startWorld.y - preset.h / 2, w: preset.w, h: preset.h });
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
        } else if (g.quick) {
          // Clicked a connect dot without dragging: add a connected copy and
          // start typing into it, like Miro.
          const id = s.quickCreate(g.quick.itemId, g.quick.side);
          if (id) s.startEditing(id);
        }
        break;
      case 'reconnect':
        s.setConnectHint(null);
        break;
      case 'draw': {
        // Keep the pen active for the next stroke, like Miro.
        const points = simplify(g.points, 0.4 / s.camera.z);
        s.addItem(makePathItem(points, g.color, g.width, g.highlight));
        setStrokeVersion((v) => v + 1);
        break;
      }
    }
  };

  const onPointerLeave = () => {
    if (!gesture.current) useBoard.getState().setConnectHint(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('[data-editor], [data-ui]')) return;
    const s = useBoard.getState();
    if (s.presenting) return;
    const id = attr(target, 'data-item-id');
    if (!id || s.tool !== 'select') return;
    // On a frame, only the title is editable.
    if (isFrame(s.items[id]) && !target.closest('[data-frame-title]')) return;
    s.startEditing(id);
  };

  // Dotted grid that scales with zoom; the step snaps by 5x to stay readable.
  let step = 20 * camera.z;
  while (step < 12) step *= 5;
  while (step > 120) step /= 5;

  const cursor = panning
    ? 'grabbing'
    : tool === 'hand' || spaceHeld
      ? 'grab'
      : isCreationTool(tool) || tool === 'connector' || tool === 'pen'
        ? 'crosshair'
        : 'default';

  return (
    <div
      ref={ref}
      className={`viewport${dropping ? ' viewport--drop' : ''}${erasing ? ' viewport--eraser' : ''}${presenting ? ' viewport--presenting' : ''}`}
      style={{
        cursor,
        ...(erasing ? ({ '--eraser-cursor': eraserCursor(eraserSize) } as CSSProperties) : {}),
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
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        // Ignore moves between children; only clear when leaving the canvas.
        if (!ref.current?.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (!file) return;
        e.preventDefault();
        const s = useBoard.getState();
        void importBoardFile(file, 'add', screenToWorld(local(e), s.camera));
      }}
    >
      <World />
      <div className="overlay">
        {!presenting && <SelectionOverlay />}
        {!presenting && <DeckControls />}
        {gesture.current?.kind === 'draw' && strokeVersion > 0 && (
          <svg className={`pen-preview${gesture.current.highlight ? ' pen-preview--highlight' : ''}`}>
            <path
              d={smoothPath(
                gesture.current.points.map((p) => ({
                  x: p.x * camera.z + camera.x,
                  y: p.y * camera.z + camera.y,
                })),
              )}
              stroke={gesture.current.color}
              strokeWidth={gesture.current.width * camera.z}
            />
          </svg>
        )}
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
  // Frames first so they sit behind everything; shallow-compared so item
  // edits that do not change the order do not re-render this list.
  const order = useBoard(useShallow((s) => renderOrder(s.order, s.items)));
  const style = {
    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`,
    // Lets world-space UI (frame titles) stay a constant size on screen.
    '--z': camera.z,
  } as CSSProperties;
  return (
    <div className="world" style={style}>
      {order.map((id) => (
        <ItemView key={id} id={id} />
      ))}
      <ConnectorLayer />
    </div>
  );
}
