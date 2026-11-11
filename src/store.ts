import { create } from 'zustand';
import type { BoardMeta, Box, Camera, Connector, Endpoint, Item, PenMode, Side, TextRun, Tool, Vec } from './types';
import { boundsOf, fitCamera, uid, zoomCameraAt } from './geometry';
import { ITEM_DEFAULTS } from './defaults';
import { connectorGeometry, makeConnector, resolveConnector } from './connectors';
import { OPPOSITE, canQuickCreate, quickCreateBox } from './quickCreate';
import type { SavedBoard } from './persistence';
import type { ExportArea } from './exportImage';
import {
  DECK,
  deckSlides,
  isDeck,
  isFrame,
  layoutDeck,
  presentationSlides,
  slideFrames,
  withFrameChildren,
  type FramePreset,
} from './frames';
import type { Gap, Guide } from './snapping';
import { prepareForInsert, type BoardContent } from './boardFile';
import { ERASER_DEFAULT, HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, PEN_COLORS, PEN_WIDTHS } from './pen';

type Snapshot = {
  items: Record<string, Item>;
  order: string[];
  connectors: Record<string, Connector>;
};
type Clip = { items: Item[]; connectors: Connector[] };
type ConnectorPatch = Partial<Pick<Connector, 'style' | 'startArrow' | 'endArrow' | 'strokeWidth' | 'stroke' | 'bend' | 'label' | 'labelAt' | 'labelSize' | 'labelColor'>>;

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
  /** Equal-spacing gap markers shown while moving. */
  gaps: Gap[];
  /** Short message shown at the bottom of the screen (e.g. after an import). */
  notice: { text: string; kind: 'info' | 'error' } | null;
  /** Pen tool settings: color and width in screen pixels. */
  pen: { color: string; width: number };
  /** Highlighter settings, kept apart from the pen so each remembers its own. */
  highlighter: { color: string; width: number };
  /** Whether the pen tool draws with the pen or the highlighter, or erases. */
  penMode: PenMode;
  /**
   * Presentation mode: index of the current slide in `presentationSlides` and the
   * camera to restore on exit. Not saved and not part of undo history.
   */
  presenting: { index: number; returnTo: Camera; overview: boolean } | null;
  /** Focus mode: the frame being worked on; everything outside it is dimmed. */
  focusId: string | null;
  /** Frame tool preset: size of a clicked frame, or 'slides' to create a slide deck. */
  framePreset: FramePreset;
  /**
   * While a frame is dragged over a slide deck: where it would be inserted
   * (slide index) and the insertion line to draw, in world coordinates.
   */
  deckDrop: { deckId: string; index: number; line: { x: number; y1: number; y2: number } } | null;
  /** Every board, for the boards menu; the open one is `boardId`. Content is saved by boards.ts. */
  boards: BoardMeta[];
  boardId: string | null;
  /** Export image dialog: open with this area preselected, or closed. */
  exportDialog: ExportArea | null;
  /**
   * Picking a custom export area on the board: the window (board units), its
   * shape ('free' or a ratio preset id), and the area to go back to on Cancel.
   */
  regionPick: { box: Box; ratio: string; back: ExportArea } | null;
  /** Eraser settings: diameter in screen pixels. */
  eraser: { size: number };
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
  setGuides(guides: Guide[], gaps?: Gap[]): void;
  showNotice(text: string, kind?: 'info' | 'error'): void;
  setPen(pen: Partial<BoardState['pen']>): void;
  setHighlighter(highlighter: Partial<BoardState['highlighter']>): void;
  setPenMode(mode: PenMode): void;
  setEraser(eraser: Partial<BoardState['eraser']>): void;
  /**
   * Present every frame (slides grid order, hidden ones skipped, decks as their
   * slides), starting at `fromId`, else the selected frame, else the first slide.
   */
  startPresenting(fromId?: string): void;
  /** Show or hide the slides grid while presenting. */
  setOverview(open: boolean): void;
  setFocus(id: string | null): void;
  setFramePreset(preset: FramePreset): void;
  /** Save a new presentation order (every slide, as listed by `slideList`). Undoable. */
  reorderSlides(ids: string[]): void;
  /** Hide a frame from (or show it in) the presentation. Undoable. */
  setSkipSlide(id: string, skip: boolean): void;
  /** Create a slide deck with one slide centered on `center`; returns the slide's id. */
  createDeck(center: Vec): string;
  /** Add a blank slide at the end of a deck (same size as the last); returns its id. */
  addSlide(deckId: string): string | null;
  /** Re-lay out every slide deck (no history: part of the change that triggered it). */
  layoutDecks(): void;
  setDeckDrop(drop: BoardState['deckDrop']): void;
  setBoards(boards: BoardMeta[]): void;
  /**
   * Show a board: replaces the content and camera, and resets undo history,
   * selection, editing, presenting and focus. Used when opening or switching boards.
   */
  loadBoardData(data: SavedBoard | null, boardId: string, boards: BoardMeta[]): void;
  /** Open the export dialog; without an area, picks the selected frame, the selection or the board. */
  openExport(area?: ExportArea): void;
  closeExport(): void;
  /** Close the dialog and show the adjustable export window on the board. */
  startRegionPick(box: Box, back: ExportArea): void;
  setRegionPick(patch: Partial<{ box: Box; ratio: string }>): void;
  /** Done: back to the dialog with this region chosen; cancel: back with the previous area. */
  finishRegionPick(done: boolean): void;
  /**
   * Insert a dragged frame into a deck as the slide at `index` (no history: the
   * drag already recorded it). `moving` is the frame plus everything that moved
   * with it, fixed when the drag started.
   */
  dropIntoDeck(frameId: string, deckId: string, index: number, moving: string[]): void;
  stopPresenting(): void;
  /** Go to a slide; clamped to the first/last slide. */
  goToSlide(index: number): void;

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
  /** Swap the whole board for imported content (one undoable step). */
  replaceBoard(content: BoardContent): void;
  /** Add imported content centered on world point `at`, and select it. */
  insertBoard(content: BoardContent, at: Vec): void;
  /** Patch a connector without recording history (call checkpoint() first). */
  updateConnector(id: string, patch: Partial<Connector>): void;
  /** Change connector styling as one undoable step. */
  styleConnectors(ids: string[], patch: ConnectorPatch): void;
  /** Delete items and/or connectors. */
  deleteItems(ids: string[]): void;
  /**
   * Swap each listed item for the given replacement items, at its place in the
   * z-order (used by the eraser to split strokes). Records no history.
   */
  replaceItems(changes: Record<string, Item[]>): void;
  setSelected(ids: string[]): void;
  selectAll(): void;
  startEditing(id: string): void;
  /**
   * Save edited text. `rich`: the styled runs (null = plain text); omitted for
   * plain editors (labels, frame titles), which keep the item's rich text as is.
   */
  finishEditing(id: string, text: string, rich?: TextRun[] | null): void;
  duplicate(ids: string[]): void;
  copy(ids: string[]): void;
  paste(): void;
  reorder(ids: string[], where: 'front' | 'back'): void;
  nudge(ids: string[], dx: number, dy: number): void;
  setColor(ids: string[], color: string): void;
  /** Change items' style (text options etc.); `patch` gives each item's change. One undo step. */
  restyleItems(ids: string[], patch: (it: Item) => Partial<Item>): void;
}

/**
 * Without a saved camera, put the world origin at the center once the viewport
 * has a size. Boards are loaded by `initBoards` (boards.ts) before the app renders.
 */
let needsCentering = true;

const snapshot = (s: BoardState): Snapshot => ({
  items: s.items,
  order: s.order,
  connectors: s.connectors,
});

const exists = (s: Snapshot, id: string) => !!(s.items[id] || s.connectors[id]);

/**
 * Connectors after the items in `gone` are removed: connectors in `gone` are
 * dropped, and an end attached to a removed item becomes a free point where it was.
 */
function detachConnectors(s: BoardState, gone: Set<string>): Record<string, Connector> {
  const connectors: Record<string, Connector> = {};
  for (const c of Object.values(s.connectors)) {
    if (gone.has(c.id)) continue;
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
  return connectors;
}

const movePoint = (e: Endpoint, dx: number, dy: number): Endpoint =>
  e.kind === 'point' ? { kind: 'point', x: e.x + dx, y: e.y + dy } : e;

export const useBoard = create<BoardState>()((set, get) => ({
  items: {},
  order: [],
  connectors: {},
  selected: [],
  editingId: null,
  tool: 'select',
  camera: { x: 0, y: 0, z: 1 },
  viewport: { w: 0, h: 0 },
  interacting: false,
  spaceHeld: false,
  connectHint: null,
  guides: [],
  gaps: [],
  notice: null,
  pen: { color: PEN_COLORS[0], width: PEN_WIDTHS[1] },
  highlighter: { color: HIGHLIGHTER_COLORS[0], width: HIGHLIGHTER_WIDTHS[1] },
  penMode: 'pen',
  eraser: { size: ERASER_DEFAULT },
  presenting: null,
  focusId: null,
  framePreset: 'custom',
  deckDrop: null,
  boards: [],
  boardId: null,
  exportDialog: null,
  regionPick: null,
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
    set({ camera: fitCamera(b, viewport.w, viewport.h, 80, 1) });
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
  setGuides: (guides, gaps = []) => {
    const s = get();
    if (!guides.length && !gaps.length && !s.guides.length && !s.gaps.length) return;
    set({ guides, gaps });
  },
  setPen: (pen) => set((s) => ({ pen: { ...s.pen, ...pen } })),
  setHighlighter: (highlighter) => set((s) => ({ highlighter: { ...s.highlighter, ...highlighter } })),
  setPenMode: (penMode) => set({ penMode }),
  setEraser: (eraser) => set((s) => ({ eraser: { ...s.eraser, ...eraser } })),
  startPresenting: (fromId) => {
    const s = get();
    if (s.presenting) return;
    const slides = presentationSlides(s.items, s.order);
    if (!slides.length) {
      s.showNotice(
        slideFrames(s.items, s.order).length
          ? 'Every slide is hidden. Select a frame and click the eye in its toolbar to show it.'
          : 'Add a frame (F) to present it as a slide.',
      );
      return;
    }
    const picked = fromId ?? s.selected.find((id) => isFrame(s.items[id]));
    const index = Math.max(0, slides.findIndex((f) => f.id === picked));
    set({ presenting: { index, returnTo: s.camera, overview: false }, selected: [], editingId: null, tool: 'select', connectHint: null });
  },
  stopPresenting: () => {
    const p = get().presenting;
    if (p) set({ presenting: null, camera: p.returnTo });
  },
  setOverview: (overview) => {
    const p = get().presenting;
    if (p) set({ presenting: { ...p, overview } });
  },
  setFocus: (focusId) => set({ focusId }),
  setFramePreset: (framePreset) => set({ framePreset }),
  reorderSlides: (ids) => {
    const s = get();
    const decks = new Map<string, string[]>();
    const units: string[] = [];
    for (const id of ids) {
      const f = s.items[id];
      if (!isFrame(f)) continue;
      // A deck's slides move together in the overall order; inside the deck they
      // take the new order by being laid out again.
      const deck = s.order.map((d) => s.items[d]).find((d) => isDeck(d) && deckSlides(d, s.items, s.order).some((x) => x.id === id));
      const unit = deck ? deck.id : id;
      if (!units.includes(unit)) units.push(unit);
      if (deck) decks.set(deck.id, [...(decks.get(deck.id) ?? []), id]);
    }
    s.checkpoint();
    const patches: Record<string, Partial<Item>> = {};
    units.forEach((id, i) => (patches[id] = { slide: i }));
    s.updateItems(patches);
    for (const [deckId, slideIds] of decks) {
      const st = get();
      const deck = st.items[deckId];
      const slides = slideIds.map((id) => st.items[id]).filter(Boolean);
      if (deck) st.updateItems(layoutDeck(deck, slides, st.items, st.order));
    }
  },
  setSkipSlide: (id, skip) => {
    const s = get();
    if (!isFrame(s.items[id])) return;
    s.checkpoint();
    s.updateItems({ [id]: { skipSlide: skip || undefined } });
  },
  createDeck: (center) => {
    const s = get();
    const w = DECK.slideW + DECK.pad * 2;
    const h = DECK.slideH + DECK.pad * 2;
    const deck: Item = {
      ...ITEM_DEFAULTS.frame,
      id: uid(),
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
      fill: '#ECECF2',
      text: 'Slides',
      deck: true,
    };
    const slide: Item = {
      ...ITEM_DEFAULTS.frame,
      id: uid(),
      x: deck.x + DECK.pad,
      y: deck.y + DECK.pad,
      w: DECK.slideW,
      h: DECK.slideH,
      text: 'Slide 1',
    };
    s.checkpoint();
    set((st) => ({
      items: { ...st.items, [deck.id]: deck, [slide.id]: slide },
      order: [...st.order, deck.id, slide.id],
      selected: [slide.id],
      tool: 'select',
      editingId: null,
    }));
    return slide.id;
  },
  addSlide: (deckId) => {
    const s = get();
    const deck = s.items[deckId];
    if (!isDeck(deck)) return null;
    const slides = deckSlides(deck, s.items, s.order);
    const last = slides[slides.length - 1];
    const w = last?.w ?? DECK.slideW;
    const h = last?.h ?? DECK.slideH;
    const slide: Item = {
      ...ITEM_DEFAULTS.frame,
      id: uid(),
      // Past the last slide; layout pulls it into place and grows the deck.
      x: last ? last.x + last.w + DECK.gap : deck.x + DECK.pad,
      y: last ? last.y : deck.y + DECK.pad,
      w,
      h,
      text: `Slide ${slides.length + 1}`,
    };
    s.checkpoint();
    // Grow the deck first so the new slide's center is inside it (membership is geometric).
    set((st) => ({
      items: {
        ...st.items,
        [deckId]: { ...deck, w: slide.x + w + DECK.pad - deck.x, h: Math.max(deck.h, h + DECK.pad * 2) },
        [slide.id]: slide,
      },
      order: [...st.order, slide.id],
      selected: [slide.id],
      tool: 'select',
      editingId: null,
    }));
    get().layoutDecks();
    return slide.id;
  },
  setBoards: (boards) => set({ boards }),
  loadBoardData: (data, boardId, boards) => {
    const { viewport } = get();
    const hasViewport = viewport.w > 0 && viewport.h > 0;
    needsCentering = !data?.camera && !hasViewport;
    const camera = data?.camera ?? (hasViewport ? { x: viewport.w / 2, y: viewport.h / 2, z: 1 } : { x: 0, y: 0, z: 1 });
    set({
      items: data?.items ?? {},
      order: data?.order ?? [],
      connectors: data?.connectors ?? {},
      camera,
      boardId,
      boards,
      past: [],
      future: [],
      selected: [],
      editingId: null,
      presenting: null,
      focusId: null,
      deckDrop: null,
      guides: [],
      gaps: [],
      connectHint: null,
      exportDialog: null,
      regionPick: null,
    });
  },
  openExport: (area) => {
    const s = get();
    if (area) {
      set({ exportDialog: area });
      return;
    }
    const frame = s.selected.length === 1 && isFrame(s.items[s.selected[0]]) ? s.selected[0] : null;
    set({
      exportDialog: frame ? { kind: 'frame', frameId: frame } : s.selected.length ? { kind: 'selection' } : { kind: 'board' },
    });
  },
  closeExport: () => set({ exportDialog: null }),
  startRegionPick: (box, back) => set({ exportDialog: null, regionPick: { box, ratio: 'free', back }, selected: [], editingId: null }),
  setRegionPick: (patch) => {
    const p = get().regionPick;
    if (p) set({ regionPick: { ...p, ...patch } });
  },
  finishRegionPick: (done) => {
    const p = get().regionPick;
    if (!p) return;
    set({ regionPick: null, exportDialog: done ? { kind: 'region', box: p.box } : p.back });
  },
  setDeckDrop: (deckDrop) => {
    if (deckDrop || get().deckDrop) set({ deckDrop });
  },
  dropIntoDeck: (frameId, deckId, index, moving) => {
    const s = get();
    const deck = s.items[deckId];
    const frame = s.items[frameId];
    if (!isDeck(deck) || !isFrame(frame)) return;
    // Work out the deck's slides without the dragged group, so a frame that
    // landed over a slide is not taken for part of that slide.
    const away = new Set(moving);
    const rest = s.order.filter((id) => !away.has(id));
    const slides = deckSlides(deck, s.items, rest);
    slides.splice(Math.min(index, slides.length), 0, frame);
    const carry = { [frameId]: moving.filter((id) => id !== frameId) };
    s.updateItems(layoutDeck(deck, slides, s.items, rest, carry));
  },
  layoutDecks: () => {
    const s = get();
    const decks = s.order.map((id) => s.items[id]).filter(isDeck);
    if (!decks.length) return;
    for (const d of decks) {
      const st = get();
      const deck = st.items[d.id];
      if (deck) st.updateItems(layoutDeck(deck, deckSlides(deck, st.items, st.order), st.items, st.order));
    }
  },
  goToSlide: (index) => {
    const s = get();
    if (!s.presenting) return;
    const last = presentationSlides(s.items, s.order).length - 1;
    const next = Math.min(Math.max(index, 0), Math.max(last, 0));
    if (next !== s.presenting.index) set({ presenting: { ...s.presenting, index: next } });
  },
  showNotice: (text, kind = 'info') => {
    const notice = { text, kind };
    set({ notice });
    // Clear after a few seconds unless a newer notice replaced it.
    window.setTimeout(() => {
      if (get().notice === notice) set({ notice: null });
    }, kind === 'error' ? 6000 : 4000);
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
  replaceBoard: (content) => {
    get().checkpoint();
    set({
      items: Object.fromEntries(content.items.map((it) => [it.id, it])),
      order: content.items.map((it) => it.id),
      connectors: Object.fromEntries(content.connectors.map((c) => [c.id, c])),
      selected: [],
      editingId: null,
    });
    get().zoomToFit();
  },
  insertBoard: (content, at) => {
    const { items, connectors } = prepareForInsert(content, at);
    get().checkpoint();
    set((s) => {
      const nextItems = { ...s.items };
      for (const it of items) nextItems[it.id] = it;
      const nextConnectors = { ...s.connectors };
      for (const c of connectors) nextConnectors[c.id] = c;
      return {
        items: nextItems,
        connectors: nextConnectors,
        order: [...s.order, ...items.map((it) => it.id)],
        selected: [...items.map((it) => it.id), ...connectors.map((c) => c.id)],
        editingId: null,
      };
    });
    get().layoutDecks();
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
      return {
        items,
        connectors: detachConnectors(s, gone),
        order: s.order.filter((id) => !gone.has(id)),
        selected: s.selected.filter((id) => !gone.has(id)),
        editingId: s.editingId && gone.has(s.editingId) ? null : s.editingId,
      };
    });
    // Close the gap a deleted slide leaves in its deck.
    get().layoutDecks();
  },
  replaceItems: (changes) =>
    set((s) => {
      const gone = new Set(Object.keys(changes).filter((id) => s.items[id]));
      if (!gone.size) return {};
      const items = { ...s.items };
      const order: string[] = [];
      for (const id of s.order) {
        if (!gone.has(id)) {
          order.push(id);
          continue;
        }
        delete items[id];
        for (const piece of changes[id]) {
          items[piece.id] = piece;
          order.push(piece.id);
        }
      }
      return {
        items,
        order,
        connectors: detachConnectors(s, gone),
        selected: s.selected.filter((id) => !gone.has(id)),
      };
    }),
  setSelected: (selected) => set({ selected }),
  selectAll: () =>
    set((s) => ({ selected: [...s.order, ...Object.keys(s.connectors)], editingId: null })),
  startEditing: (id) => {
    // A connector's text is its label.
    if (get().connectors[id]) {
      set({ editingId: id, selected: [id], tool: 'select' });
      return;
    }
    // Pen strokes have no text to edit.
    if (!get().items[id] || get().items[id].type === 'path') return;
    set({ editingId: id, selected: [id], tool: 'select' });
  },
  finishEditing: (id, text, rich) => {
    const s = get();
    if (s.editingId === id) set({ editingId: null });
    const conn = s.connectors[id];
    if (conn) {
      // An empty label removes it (and forgets where it was dragged to).
      const label = text.trim() ? text : undefined;
      if (conn.label === label) return;
      s.checkpoint();
      s.updateConnector(id, { label, labelAt: label ? conn.labelAt : undefined });
      return;
    }
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
    const nextRich = rich === undefined ? item.rich : (rich ?? undefined);
    if (item.text === text && JSON.stringify(item.rich ?? null) === JSON.stringify(nextRich ?? null)) return;
    s.checkpoint();
    s.updateItems({ [id]: { text, rich: nextRich } });
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
  restyleItems: (ids, patch) => {
    const s = get();
    const targets = ids.filter((id) => s.items[id]);
    if (!targets.length) return;
    s.checkpoint();
    s.updateItems(Object.fromEntries(targets.map((id) => [id, patch(s.items[id])])));
  },
  setColor: (ids, color) => {
    if (!ids.length) return;
    const s = get();
    s.checkpoint();
    const patches: Record<string, Partial<Item>> = {};
    for (const id of ids) {
      const it = s.items[id];
      if (it) patches[id] = it.type === 'text' || it.type === 'path' ? { color } : { fill: color };
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
  // A copy dropped inside a deck becomes a slide next to the original.
  useBoard.getState().layoutDecks();
  return { items, connectors };
}

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) (window as unknown as { board: typeof useBoard }).board = useBoard;
