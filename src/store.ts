import { create } from 'zustand';
import type { Box, Camera, Connector, Endpoint, Item, Side, Tool, Vec } from './types';
import { boundsOf, clampZoom, uid, zoomCameraAt } from './geometry';
import { connectorGeometry, makeConnector, resolveConnector } from './connectors';
import { OPPOSITE, canQuickCreate, quickCreateBox } from './quickCreate';
import { loadBoard, saveBoard } from './persistence';
import { withFrameChildren } from './frames';
import type { Guide } from './snapping';

type Snapshot = {
  items: Record<string, Item>;
  order: string[];
  connectors: Record<string, Connector>;
};
type Clip = { items: Item[]; connectors: Connector[] };
type ConnectorPatch = Partial<Pick<Connector, 'style' | 'startArrow' | 'endArrow' | 'strokeWidth' | 'stroke' | 'bend'>>;

const HISTORY_LIMIT = 200;
const PASTE_OFFSET = 24;

export interface BoardState {
  items: Record<string, Item>;
  /** Z-order: later ids render on top. */
  order: string[];
  connectors: Record<string, Connector>;
  /** Selected item and connector ids (ids are unique across both). */
  selected: string[];
  editingId: string | null;
  tool: Tool;
  camera: Camera;
  viewport: { w: number; h: number };
  /** True while a drag gesture (move / resize / marquee / connect) is in progress. */
  interacting: boolean;
  spaceHeld: boolean;
  /** Item (and side) a connector end would attach to, for hover feedback. */
  connectHint: { itemId: string; side: Side | null } | null;
  /** Alignment guides shown while moving or resizing. */
  guides: Guide[];
  past: Snapshot[];
  future: Snapshot[];
  clipboard: Clip;

  setTool(tool: Tool): void;
  setCamera(camera: Camera): void;
  panBy(dx: number, dy: number): void;
  zoomAt(screen: Vec, factor: number): void;
  setZoom(z: number): void;
  zoomToFit(): void;
  setViewport(w: number, h: number): void;
  setInteracting(v: boolean): void;
  setSpaceHeld(v: boolean): void;
  setConnectHint(hint: BoardState['connectHint']): void;
  setGuides(guides: Guide[]): void;

  /** Record the current board state so the next change can be undone. */
  checkpoint(): void;
  undo(): void;
  redo(): void;

  addItem(item: Item): void;
  /** Patch items without recording history (call checkpoint() first). */
  updateItems(patches: Record<string, Partial<Item>>): void;
  addConnector(c: Connector): void;
  /**
   * Add a same-type copy of an item next to its `side`, joined by a connector,
   * as one undoable step. Returns the new item's id.
   */
  quickCreate(srcId: string, side: Side): string | null;
  /** Patch a connector without recording history (call checkpoint() first). */
  updateConnector(id: string, patch: Partial<Connector>): void;
  /** Change connector styling as one undoable step. */
  styleConnectors(ids: string[], patch: ConnectorPatch): void;
  /** Delete items and/or connectors. */
  deleteItems(ids: string[]): void;
  setSelected(ids: string[]): void;
  selectAll(): void;
  startEditing(id: string): void;
  finishEditing(id: string, text: string): void;
  duplicate(ids: string[]): void;
  copy(ids: string[]): void;
  paste(): void;
  reorder(ids: string[], where: 'front' | 'back'): void;
  nudge(ids: string[], dx: number, dy: number): void;
  setColor(ids: string[], color: string): void;
}

const saved = loadBoard();
const initialCamera: Camera = saved?.camera ?? { x: 0, y: 0, z: 1 };
/** Without a saved camera, put the world origin at the center once the viewport has a size. */
let needsCentering = !saved?.camera;

const snapshot = (s: BoardState): Snapshot => ({
  items: s.items,
  order: s.order,
  connectors: s.connectors,
});

const exists = (s: Snapshot, id: string) => !!(s.items[id] || s.connectors[id]);

const movePoint = (e: Endpoint, dx: number, dy: number): Endpoint =>
  e.kind === 'point' ? { kind: 'point', x: e.x + dx, y: e.y + dy } : e;

export const useBoard = create<BoardState>()((set, get) => ({
  items: saved?.items ?? {},
  order: saved?.order ?? [],
  connectors: saved?.connectors ?? {},
  selected: [],
  editingId: null,
  tool: 'select',
  camera: initialCamera,
  viewport: { w: 0, h: 0 },
  interacting: false,
  spaceHeld: false,
  connectHint: null,
  guides: [],
  past: [],
  future: [],
  clipboard: { items: [], connectors: [] },

  setTool: (tool) => set({ tool, editingId: null, connectHint: null }),
  setCamera: (camera) => set({ camera }),
  panBy: (dx, dy) =>
    set((s) => ({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } })),
  zoomAt: (screen, factor) =>
    set((s) => ({ camera: zoomCameraAt(s.camera, screen, s.camera.z * factor) })),
  setZoom: (z) =>
    set((s) => ({
      camera: zoomCameraAt(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 }, z),
    })),
  zoomToFit: () => {
    const { items, order, connectors, viewport } = get();
    const boxes: Box[] = order.map((id) => items[id]);
    for (const c of Object.values(connectors)) {
      const g = connectorGeometry(c, items);
      if (g) boxes.push(g.bounds);
    }
    const b = boundsOf(boxes);
    if (!b) {
      set({ camera: { x: viewport.w / 2, y: viewport.h / 2, z: 1 } });
      return;
    }
    const pad = 80;
    const z = clampZoom(
      Math.min((viewport.w - pad * 2) / Math.max(b.w, 1), (viewport.h - pad * 2) / Math.max(b.h, 1), 1),
    );
    set({
      camera: {
        z,
        x: viewport.w / 2 - (b.x + b.w / 2) * z,
        y: viewport.h / 2 - (b.y + b.h / 2) * z,
      },
    });
  },
  setViewport: (w, h) => {
    if (needsCentering && w > 0 && h > 0) {
      needsCentering = false;
      set((s) => ({ viewport: { w, h }, camera: { ...s.camera, x: w / 2, y: h / 2 } }));
      return;
    }
    const v = get().viewport;
    if (v.w !== w || v.h !== h) set({ viewport: { w, h } });
  },
  setInteracting: (interacting) => set({ interacting }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
  setGuides: (guides) => {
    if (!guides.length && !get().guides.length) return;
    set({ guides });
  },
  setConnectHint: (connectHint) => {
    const cur = get().connectHint;
    if (cur?.itemId === connectHint?.itemId && cur?.side === connectHint?.side) return;
    set({ connectHint });
  },

  checkpoint: () =>
    set((s) => ({
      past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT),
      future: [],
    })),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      return {
        ...prev,
        past: s.past.slice(0, -1),
        future: [snapshot(s), ...s.future],
        selected: s.selected.filter((id) => exists(prev, id)),
        editingId: null,
      };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return {
        ...next,
        past: [...s.past, snapshot(s)],
        future: s.future.slice(1),
        selected: s.selected.filter((id) => exists(next, id)),
        editingId: null,
      };
    }),

  addItem: (item) => {
    get().checkpoint();
    set((s) => ({ items: { ...s.items, [item.id]: item }, order: [...s.order, item.id] }));
  },
  updateItems: (patches) =>
    set((s) => {
      const items = { ...s.items };
      for (const id in patches) if (items[id]) items[id] = { ...items[id], ...patches[id] };
      return { items };
    }),
  addConnector: (c) => {
    get().checkpoint();
    set((s) => ({ connectors: { ...s.connectors, [c.id]: c } }));
  },
  quickCreate: (srcId, side) => {
    const s = get();
    const src = s.items[srcId];
    if (!canQuickCreate(src)) return null;
    const box = quickCreateBox(src, side, s.items, s.order);
    const item: Item = { ...src, ...box, id: uid(), text: '' };
    const link = makeConnector(
      { kind: 'item', itemId: src.id, side },
      { kind: 'item', itemId: item.id, side: OPPOSITE[side] },
    );
    s.checkpoint();
    set((st) => ({
      items: { ...st.items, [item.id]: item },
      order: [...st.order, item.id],
      connectors: { ...st.connectors, [link.id]: link },
    }));
    return item.id;
  },
  updateConnector: (id, patch) =>
    set((s) =>
      s.connectors[id] ? { connectors: { ...s.connectors, [id]: { ...s.connectors[id], ...patch } } } : {},
    ),
  styleConnectors: (ids, patch) => {
    const s = get();
    const targets = ids.filter((id) => s.connectors[id]);
    if (!targets.length) return;
    s.checkpoint();
    set((st) => {
      const connectors = { ...st.connectors };
      for (const id of targets) connectors[id] = { ...connectors[id], ...patch };
      return { connectors };
    });
  },
  deleteItems: (ids) => {
    if (!ids.length) return;
    get().checkpoint();
    set((s) => {
      const gone = new Set(ids);
      const items = { ...s.items };
      for (const id of ids) delete items[id];
      const connectors: Record<string, Connector> = {};
      for (const c of Object.values(s.connectors)) {
        if (gone.has(c.id)) continue;
        // A connector attached to a deleted item keeps that end as a free point.
        const detachFrom = c.from.kind === 'item' && gone.has(c.from.itemId);
        const detachTo = c.to.kind === 'item' && gone.has(c.to.itemId);
        if (!detachFrom && !detachTo) {
          connectors[c.id] = c;
          continue;
        }
        const r = resolveConnector(c, s.items);
        if (!r) continue;
        connectors[c.id] = {
          ...c,
          from: detachFrom ? { kind: 'point', x: r.a.x, y: r.a.y } : c.from,
          to: detachTo ? { kind: 'point', x: r.b.x, y: r.b.y } : c.to,
        };
      }
      return {
        items,
        connectors,
        order: s.order.filter((id) => !gone.has(id)),
        selected: s.selected.filter((id) => !gone.has(id)),
        editingId: s.editingId && gone.has(s.editingId) ? null : s.editingId,
      };
    });
  },
  setSelected: (selected) => set({ selected }),
  selectAll: () =>
    set((s) => ({ selected: [...s.order, ...Object.keys(s.connectors)], editingId: null })),
  startEditing: (id) => {
    if (!get().items[id]) return;
    set({ editingId: id, selected: [id], tool: 'select' });
  },
  finishEditing: (id, text) => {
    const s = get();
    if (s.editingId === id) set({ editingId: null });
    const item = s.items[id];
    if (!item) return;
    if (item.type === 'text' && !text.trim()) {
      if (!item.text.trim()) {
        // A fresh text item left empty: its creation already has an undo
        // checkpoint, so drop it without recording another one.
        const items = { ...s.items };
        delete items[id];
        set({
          items,
          order: s.order.filter((x) => x !== id),
          selected: s.selected.filter((x) => x !== id),
        });
      } else {
        s.deleteItems([id]);
      }
      return;
    }
    if (item.type === 'frame' && !text.trim()) text = 'Frame';
    if (item.text === text) return;
    s.checkpoint();
    s.updateItems({ [id]: { text } });
  },
  duplicate: (ids) => {
    const clip = collect(get(), ids);
    if (clip.items.length || clip.connectors.length) insertCopies(clip);
  },
  copy: (ids) => set({ clipboard: collect(get(), ids) }),
  paste: () => {
    const { clipboard } = get();
    if (!clipboard.items.length && !clipboard.connectors.length) return;
    // Keep the pasted copies as the clipboard so repeated pastes cascade.
    set({ clipboard: insertCopies(clipboard) });
  },
  reorder: (ids, where) => {
    const s = get();
    const moving = new Set(ids.filter((id) => s.items[id]));
    if (!moving.size) return;
    s.checkpoint();
    set((st) => {
      const rest = st.order.filter((id) => !moving.has(id));
      const picked = st.order.filter((id) => moving.has(id));
      return { order: where === 'front' ? [...rest, ...picked] : [...picked, ...rest] };
    });
  },
  nudge: (sel, dx, dy) => {
    if (!sel.length) return;
    const s = get();
    // Frames carry their contents along.
    const ids = withFrameChildren(sel, s.items, s.order);
    s.checkpoint();
    const patches: Record<string, Partial<Item>> = {};
    for (const id of ids) {
      const it = s.items[id];
      if (it) patches[id] = { x: it.x + dx, y: it.y + dy };
      const c = s.connectors[id];
      if (c) s.updateConnector(id, { from: movePoint(c.from, dx, dy), to: movePoint(c.to, dx, dy) });
    }
    s.updateItems(patches);
  },
  setColor: (ids, color) => {
    if (!ids.length) return;
    const s = get();
    s.checkpoint();
    const patches: Record<string, Partial<Item>> = {};
    for (const id of ids) {
      const it = s.items[id];
      if (it) patches[id] = it.type === 'text' ? { color } : { fill: color };
      if (s.connectors[id]) s.updateConnector(id, { stroke: color });
    }
    s.updateItems(patches);
  },
}));

/**
 * Gather `ids` for copying. Connectors running between two copied items come
 * along automatically; ends attached to items that are not copied become free points.
 */
function collect(s: BoardState, sel: string[]): Clip {
  // Copying a frame copies what is inside it too.
  const ids = withFrameChildren(sel, s.items, s.order);
  const idSet = new Set(ids);
  const items = ids.map((id) => s.items[id]).filter(Boolean);
  const itemIds = new Set(items.map((it) => it.id));
  const inside = (e: Endpoint) => e.kind === 'item' && itemIds.has(e.itemId);
  const connectors: Connector[] = [];
  for (const c of Object.values(s.connectors)) {
    if (!idSet.has(c.id) && !(inside(c.from) && inside(c.to))) continue;
    const r = resolveConnector(c, s.items);
    if (!r) continue;
    connectors.push({
      ...c,
      from: inside(c.from) ? c.from : { kind: 'point', x: r.a.x, y: r.a.y },
      to: inside(c.to) ? c.to : { kind: 'point', x: r.b.x, y: r.b.y },
    });
  }
  return { items, connectors };
}

function insertCopies(clip: Clip): Clip {
  useBoard.getState().checkpoint();
  const idMap = new Map<string, string>();
  const items = clip.items.map((it) => {
    const id = uid();
    idMap.set(it.id, id);
    return { ...it, id, x: it.x + PASTE_OFFSET, y: it.y + PASTE_OFFSET };
  });
  const remap = (e: Endpoint): Endpoint =>
    e.kind === 'item'
      ? { ...e, itemId: idMap.get(e.itemId) ?? e.itemId }
      : movePoint(e, PASTE_OFFSET, PASTE_OFFSET);
  const connectors = clip.connectors.map((c) => ({ ...c, id: uid(), from: remap(c.from), to: remap(c.to) }));

  useBoard.setState((st) => {
    const nextItems = { ...st.items };
    for (const it of items) nextItems[it.id] = it;
    const nextConnectors = { ...st.connectors };
    for (const c of connectors) nextConnectors[c.id] = c;
    return {
      items: nextItems,
      connectors: nextConnectors,
      order: [...st.order, ...items.map((it) => it.id)],
      selected: [...items.map((it) => it.id), ...connectors.map((c) => c.id)],
      editingId: null,
    };
  });
  return { items, connectors };
}

// Persist board + camera to localStorage (debounced).
let saveTimer: number | undefined;
useBoard.subscribe((s, prev) => {
  if (
    s.items === prev.items &&
    s.order === prev.order &&
    s.connectors === prev.connectors &&
    s.camera === prev.camera
  ) {
    return;
  }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const { items, order, connectors, camera } = useBoard.getState();
    saveBoard({ items, order, connectors, camera });
  }, 300);
});

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) (window as unknown as { board: typeof useBoard }).board = useBoard;
