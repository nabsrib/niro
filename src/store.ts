import { create } from 'zustand';
import type { Camera, Item, Tool, Vec } from './types';
import { boundsOf, clampZoom, uid, zoomCameraAt } from './geometry';
import { loadBoard, saveBoard } from './persistence';

type Snapshot = { items: Record<string, Item>; order: string[] };
const HISTORY_LIMIT = 200;
const PASTE_OFFSET = 24;

export interface BoardState {
  items: Record<string, Item>;
  /** Z-order: later ids render on top. */
  order: string[];
  selected: string[];
  editingId: string | null;
  tool: Tool;
  camera: Camera;
  viewport: { w: number; h: number };
  /** True while a drag gesture (move / resize / marquee) is in progress. */
  interacting: boolean;
  spaceHeld: boolean;
  past: Snapshot[];
  future: Snapshot[];
  clipboard: Item[];

  setTool(tool: Tool): void;
  setCamera(camera: Camera): void;
  panBy(dx: number, dy: number): void;
  zoomAt(screen: Vec, factor: number): void;
  setZoom(z: number): void;
  zoomToFit(): void;
  setViewport(w: number, h: number): void;
  setInteracting(v: boolean): void;
  setSpaceHeld(v: boolean): void;

  /** Record the current board state so the next change can be undone. */
  checkpoint(): void;
  undo(): void;
  redo(): void;

  addItem(item: Item): void;
  /** Patch items without recording history (call checkpoint() first). */
  updateItems(patches: Record<string, Partial<Item>>): void;
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

export const useBoard = create<BoardState>()((set, get) => ({
  items: saved?.items ?? {},
  order: saved?.order ?? [],
  selected: [],
  editingId: null,
  tool: 'select',
  camera: initialCamera,
  viewport: { w: 0, h: 0 },
  interacting: false,
  spaceHeld: false,
  past: [],
  future: [],
  clipboard: [],

  setTool: (tool) => set({ tool, editingId: null }),
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
    const { items, order, viewport } = get();
    const b = boundsOf(order.map((id) => items[id]));
    if (!b) {
      set({ camera: { x: viewport.w / 2, y: viewport.h / 2, z: 1 } });
      return;
    }
    const pad = 80;
    const z = clampZoom(
      Math.min((viewport.w - pad * 2) / b.w, (viewport.h - pad * 2) / b.h, 1),
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

  checkpoint: () =>
    set((s) => ({
      past: [...s.past, { items: s.items, order: s.order }].slice(-HISTORY_LIMIT),
      future: [],
    })),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      return {
        items: prev.items,
        order: prev.order,
        past: s.past.slice(0, -1),
        future: [{ items: s.items, order: s.order }, ...s.future],
        selected: s.selected.filter((id) => prev.items[id]),
        editingId: null,
      };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return {
        items: next.items,
        order: next.order,
        past: [...s.past, { items: s.items, order: s.order }],
        future: s.future.slice(1),
        selected: s.selected.filter((id) => next.items[id]),
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
  deleteItems: (ids) => {
    if (!ids.length) return;
    get().checkpoint();
    set((s) => {
      const gone = new Set(ids);
      const items = { ...s.items };
      for (const id of ids) delete items[id];
      return {
        items,
        order: s.order.filter((id) => !gone.has(id)),
        selected: s.selected.filter((id) => !gone.has(id)),
        editingId: s.editingId && gone.has(s.editingId) ? null : s.editingId,
      };
    });
  },
  setSelected: (selected) => set({ selected }),
  selectAll: () => set((s) => ({ selected: [...s.order], editingId: null })),
  startEditing: (id) => set({ editingId: id, selected: [id], tool: 'select' }),
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
    if (item.text === text) return;
    s.checkpoint();
    s.updateItems({ [id]: { text } });
  },
  duplicate: (ids) => {
    const s = get();
    const src = ids.map((id) => s.items[id]).filter(Boolean);
    if (src.length) insertCopies(src);
  },
  copy: (ids) => {
    const s = get();
    set({ clipboard: ids.map((id) => s.items[id]).filter(Boolean) });
  },
  paste: () => {
    const { clipboard } = get();
    if (!clipboard.length) return;
    // Keep the pasted copies as the clipboard so repeated pastes cascade.
    set({ clipboard: insertCopies(clipboard) });
  },
  reorder: (ids, where) => {
    if (!ids.length) return;
    get().checkpoint();
    set((s) => {
      const moving = new Set(ids);
      const rest = s.order.filter((id) => !moving.has(id));
      const picked = s.order.filter((id) => moving.has(id));
      return { order: where === 'front' ? [...rest, ...picked] : [...picked, ...rest] };
    });
  },
  nudge: (ids, dx, dy) => {
    if (!ids.length) return;
    const s = get();
    s.checkpoint();
    const patches: Record<string, Partial<Item>> = {};
    for (const id of ids) {
      const it = s.items[id];
      if (it) patches[id] = { x: it.x + dx, y: it.y + dy };
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
    }
    s.updateItems(patches);
  },
}));

function insertCopies(src: Item[]): Item[] {
  useBoard.getState().checkpoint();
  const copies = src.map((it) => ({
    ...it,
    id: uid(),
    x: it.x + PASTE_OFFSET,
    y: it.y + PASTE_OFFSET,
  }));
  useBoard.setState((st) => {
    const items = { ...st.items };
    for (const c of copies) items[c.id] = c;
    return {
      items,
      order: [...st.order, ...copies.map((c) => c.id)],
      selected: copies.map((c) => c.id),
      editingId: null,
    };
  });
  return copies;
}

// Persist board + camera to localStorage (debounced).
let saveTimer: number | undefined;
useBoard.subscribe((s, prev) => {
  if (s.items === prev.items && s.order === prev.order && s.camera === prev.camera) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const { items, order, camera } = useBoard.getState();
    saveBoard({ items, order, camera });
  }, 300);
});

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) (window as unknown as { board: typeof useBoard }).board = useBoard;
