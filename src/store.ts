import { create } from 'zustand';
import type { BoardMeta, Box, Camera, Connector, Endpoint, Item, PenMode, ShapeKind, Side, TextRun, Tool, TreeLayout, Vec } from './types';
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
  isStack,
  layoutDeck,
  layoutStack,
  presentationSlides,
  slideFrames,
  withFrameChildren,
  type FramePreset,
} from './frames';
import type { Gap, Guide } from './snapping';
import { prepareForInsert, type BoardContent } from './boardFile';
import { ERASER_DEFAULT, HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, PEN_COLORS, PEN_WIDTHS } from './pen';
import { borderWidth, compartmentLayout, isCompartmentShape, shapeOf } from './shapes';
import {
  BRANCH_COLORS,
  collapsedHidden,
  isTreeRoot,
  layoutTree,
  nodeSide,
  remapTrees,
  treeChildren,
  treeDescendants,
  treeLayoutOf,
  treeRootOf,
  withTreeChildren,
} from './trees';

type Clip = { items: Item[]; connectors: Connector[] };
type ConnectorPatch = Partial<Pick<Connector, 'style' | 'startArrow' | 'endArrow' | 'strokeWidth' | 'stroke' | 'bend' | 'bends' | 'channel' | 'dash' | 'label' | 'labelAt' | 'labelSize' | 'labelColor' | 'startLabel' | 'endLabel'>>;

const PASTE_OFFSET = 24;

/**
 * Undo history. It lives in the open board's Yjs document (collab/bridge.ts sets
 * it while a board is open), so undo only reverts this person's own changes.
 * Steps follow `checkpoint()`: everything changed after one checkpoint, until the
 * next, is one step.
 */
export interface History {
  /** Start a new undo step with the next change. */
  checkpoint(): void;
  undo(): void;
  redo(): void;
  /** Forget all steps. */
  clear(): void;
}

let history: History | null = null;

export function setHistory(h: History | null) {
  history = h;
}

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
  /** Rectangle tool: the shape a new rectangle gets (shapes.ts). */
  shapeKind: ShapeKind;
  /**
   * While a frame is dragged over a slide deck: where it would be inserted
   * (slide index) and the insertion line to draw, in world coordinates.
   */
  deckDrop: { deckId: string; index: number; line: { x: number; y1: number; y2: number } } | null;
  /** While a mind map node is dragged over another node: that node (dropping moves the branch under it). */
  treeDrop: string | null;
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
  /** Whether there is a step to undo / redo (kept up to date by the history). */
  canUndo: boolean;
  canRedo: boolean;
  clipboard: Clip;
  /**
   * View only (you are a viewer on this board): only the select and hand tools,
   * no text editing; any other change is undone by the bridge (collab/bridge.ts).
   */
  readOnly: boolean;

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
  setShapeKind(kind: ShapeKind): void;
  /** Save a new presentation order (every slide, as listed by `slideList`). Undoable. */
  reorderSlides(ids: string[]): void;
  /** Hide a frame from (or show it in) the presentation. Undoable. */
  setSkipSlide(id: string, skip: boolean): void;
  /** Create a slide deck with one slide centered on `center`; returns the slide's id. */
  createDeck(center: Vec): string;
  /** Add a blank slide at the end of a deck (same size as the last); returns its id. */
  addSlide(deckId: string): string | null;
  /**
   * Re-lay out every slide deck, mind map / tree and stacked frame (kanban
   * column). No history: part of the change that triggered it.
   */
  layoutDecks(): void;
  /**
   * Start a mind map: turn item `fromId` into its central node, or (no id) add
   * a new central node at `at` and start typing in it.
   */
  startMindMap(at: Vec, fromId?: string): void;
  /** Add a child (or a sibling) of tree node `id`, lay out, and start typing in it. One undo step. */
  addTreeNode(id: string, kind: 'child' | 'sibling'): string | null;
  /** Fold / unfold the branch below tree node `id`. One undo step. */
  toggleCollapse(id: string): void;
  /** Change how the tree `rootId` is laid out (mind map, right only, org chart). One undo step. */
  setTreeLayout(rootId: string, layout: TreeLayout): void;
  /** Move tree node `id` (with its branch) under `parentId` (no history: part of the drag). */
  reparentNode(id: string, parentId: string): boolean;
  setTreeDrop(id: string | null): void;
  /** Resize a frame to wrap what is inside it (40 units of margin). One undo step; false if it is empty. */
  fitFrameToContent(id: string): boolean;
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

  /** Call before a change that should be undoable: the next change starts a new undo step. */
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

/** A new mind map node: a white rounded box with a colored border, ready for text. */
function makeNode(x: number, y: number, w: number, h: number, border: string, fontSize: number): Item {
  return { ...ITEM_DEFAULTS.rect, id: uid(), x, y, w, h, shape: 'round', fill: '#FFFFFF', border, borderWidth: 2, fontSize, text: '' };
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
  shapeKind: 'rect',
  deckDrop: null,
  treeDrop: null,
  boards: [],
  boardId: null,
  exportDialog: null,
  regionPick: null,
  canUndo: false,
  canRedo: false,
  clipboard: { items: [], connectors: [] },
  readOnly: false,

  setTool: (tool) => {
    if (get().readOnly && tool !== 'select' && tool !== 'hand') return;
    set({ tool, editingId: null, connectHint: null });
  },
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
  setShapeKind: (shapeKind) => set({ shapeKind }),
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
      selected: [],
      editingId: null,
      presenting: null,
      focusId: null,
      deckDrop: null,
      treeDrop: null,
      guides: [],
      gaps: [],
      connectHint: null,
      exportDialog: null,
      regionPick: null,
    });
    // Loaded content is never an undo step (also when it lands in an already
    // open board's document, as "Open JSON as a new board" does).
    history?.clear();
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
  fitFrameToContent: (id) => {
    const s = get();
    const frame = s.items[id];
    if (!isFrame(frame) || isDeck(frame)) return false;
    const inside = withFrameChildren([id], s.items, s.order)
      .filter((x) => x !== id)
      .map((x) => s.items[x])
      .filter(Boolean);
    const b = boundsOf(inside);
    if (!b) return false;
    const pad = 40;
    s.checkpoint();
    s.updateItems({ [id]: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 } });
    // A slide in a deck changed size: the deck lays out again.
    get().layoutDecks();
    return true;
  },
  layoutDecks: () => {
    const s = get();
    for (const d of s.order.map((id) => s.items[id]).filter(isDeck)) {
      const st = get();
      const deck = st.items[d.id];
      if (deck) st.updateItems(layoutDeck(deck, deckSlides(deck, st.items, st.order), st.items, st.order));
    }
    // Mind maps and trees, from each root.
    for (const rootId of get().order.filter((id) => isTreeRoot(get().items[id]))) {
      const st = get();
      const p = layoutTree(rootId, st.items, st.connectors);
      if (Object.keys(p.items).length) st.updateItems(p.items);
      for (const [cid, patch] of Object.entries(p.connectors)) st.updateConnector(cid, patch);
    }
    // Kanban columns.
    for (const f of get().order.map((id) => get().items[id]).filter(isStack)) {
      const st = get();
      const frame = st.items[f.id];
      if (!frame) continue;
      const patches = layoutStack(frame, st.items, st.order);
      if (Object.keys(patches).length) st.updateItems(patches);
    }
  },
  startMindMap: (at, fromId) => {
    const s = get();
    if (s.readOnly) return;
    const from = fromId ? s.items[fromId] : undefined;
    if (from) {
      if (from.tree || from.locked || (from.type !== 'rect' && from.type !== 'ellipse' && from.type !== 'sticky')) return;
      s.checkpoint();
      s.updateItems({ [from.id]: { tree: { layout: 'mind' } } });
      s.setSelected([from.id]);
      return;
    }
    const root: Item = {
      ...makeNode(at.x - 110, at.y - 40, 220, 80, '#1A1A1A', 20),
      bold: true,
      tree: { layout: 'mind' },
    };
    s.checkpoint();
    set((st) => ({ items: { ...st.items, [root.id]: root }, order: [...st.order, root.id], tool: 'select' }));
    s.startEditing(root.id);
  },
  addTreeNode: (id, kind) => {
    const s = get();
    const node = s.items[id];
    if (s.readOnly || !node?.tree) return null;
    const rootId = treeRootOf(s.items, id);
    if (!rootId) return null;
    const root = s.items[rootId];
    // The root has no siblings: Enter on it adds a child too.
    const parentId = kind === 'sibling' && node.tree.parent ? node.tree.parent : id;
    const parent = s.items[parentId];
    const layout = treeLayoutOf(root);
    const siblings = (treeChildren(s.items).get(parentId) ?? []).map((k) => s.items[k]).filter(Boolean);
    const depth = parentId === rootId ? 1 : 2;
    const [w, h, size] = depth === 1 ? [180, 56, 18] : [160, 48, 16];
    // Color: each main branch its own, then the branch's color all the way down.
    const color =
      parentId === rootId ? BRANCH_COLORS[siblings.length % BRANCH_COLORS.length] : (parent.border ?? BRANCH_COLORS[0]);
    // Start where the layout will keep it in this order: just after the node (sibling) or the last child.
    const after = kind === 'sibling' && parentId !== id ? node : siblings[siblings.length - 1];
    let x: number;
    let y: number;
    if (layout === 'org') {
      x = after ? after.x + after.w / 2 + 1 - w / 2 : parent.x + parent.w / 2 - w / 2;
      y = parent.y + parent.h + 70;
    } else {
      let side = nodeSide(s.items, kind === 'sibling' && parentId !== id ? id : parentId);
      if (parentId === rootId && layout === 'mind' && kind === 'child') {
        // A new main branch goes to the side with fewer.
        const rc = root.x + root.w / 2;
        const lefts = siblings.filter((k) => k.x + k.w / 2 < rc).length;
        side = lefts < siblings.length - lefts ? 'left' : 'right';
      }
      const sameSide = siblings.filter((k) => (k.x + k.w / 2 < root.x + root.w / 2 ? 'left' : 'right') === side || parentId !== rootId);
      const last = kind === 'sibling' && parentId !== id ? node : sameSide[sameSide.length - 1];
      x = side === 'left' ? parent.x - 70 - w : parent.x + parent.w + 70;
      y = last ? last.y + last.h / 2 + 1 - h / 2 : parent.y + parent.h / 2 - h / 2;
    }
    const child: Item = { ...makeNode(x, y, w, h, color, size), tree: { parent: parentId } };
    const line: Connector = {
      ...makeConnector({ kind: 'item', itemId: parentId, side: null }, { kind: 'item', itemId: child.id, side: null }),
      style: layout === 'org' ? 'elbow' : 'curved',
      stroke: color,
      strokeWidth: depth === 1 ? 3 : 2,
      endArrow: 'none',
      branch: true,
    };
    s.checkpoint();
    set((st) => ({
      items: {
        ...st.items,
        [child.id]: child,
        // Adding under a folded node opens it.
        ...(parent.tree?.collapsed ? { [parentId]: { ...parent, tree: { ...parent.tree, collapsed: undefined } } } : {}),
      },
      order: [...st.order, child.id],
      connectors: { ...st.connectors, [line.id]: line },
    }));
    get().layoutDecks();
    get().startEditing(child.id);
    return child.id;
  },
  toggleCollapse: (id) => {
    const s = get();
    const node = s.items[id];
    if (s.readOnly || !node?.tree) return;
    const collapsed = !node.tree.collapsed;
    s.checkpoint();
    s.updateItems({ [id]: { tree: { ...node.tree, collapsed: collapsed || undefined } } });
    if (collapsed) {
      const hidden = new Set(treeDescendants(get().items, [id]));
      set((st) => ({ selected: st.selected.filter((x) => !hidden.has(x)) }));
    }
    get().layoutDecks();
  },
  setTreeLayout: (rootId, layout) => {
    const s = get();
    const root = s.items[rootId];
    if (s.readOnly || !root?.tree || treeLayoutOf(root) === layout) return;
    s.checkpoint();
    const patches: Record<string, Partial<Item>> = { [rootId]: { tree: { ...root.tree, layout } } };
    if (layout === 'mind') {
      // Share the main branches out between both sides, in their current order.
      const rc = root.x + root.w / 2;
      const kids = (treeChildren(s.items).get(rootId) ?? []).map((k) => s.items[k]).filter(Boolean);
      kids
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .forEach((k, i) => {
          const right = i % 2 === 0;
          patches[k.id] = { x: right ? rc + 100 : rc - 100 - k.w };
        });
    }
    s.updateItems(patches);
    get().layoutDecks();
  },
  reparentNode: (id, parentId) => {
    const s = get();
    const node = s.items[id];
    const parent = s.items[parentId];
    if (!node?.tree?.parent || !parent?.tree || id === parentId || node.tree.parent === parentId) return false;
    // Never under its own branch.
    if (treeDescendants(s.items, [id]).includes(parentId)) return false;
    const rootId = treeRootOf(s.items, parentId);
    const patches: Record<string, Partial<Item>> = { [id]: { tree: { ...node.tree, parent: parentId } } };
    // Take the new branch's color (a new main branch keeps its own).
    const color = rootId !== parentId ? parent.border : undefined;
    const branch = withTreeChildren([id], s.items);
    if (color) for (const k of branch) patches[k] = { ...patches[k], border: color };
    s.updateItems(patches);
    for (const c of Object.values(s.connectors)) {
      if (!c.branch || c.to.kind !== 'item' || c.from.kind !== 'item') continue;
      if (c.to.itemId === id) s.updateConnector(c.id, { from: { ...c.from, itemId: parentId }, ...(color ? { stroke: color } : {}) });
      else if (color && branch.includes(c.to.itemId)) s.updateConnector(c.id, { stroke: color });
    }
    return true;
  },
  setTreeDrop: (treeDrop) => {
    if (treeDrop !== get().treeDrop) set({ treeDrop });
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

  // The history writes the undone change to the document; the bridge brings it
  // back into the store and drops selected ids that no longer exist.
  checkpoint: () => history?.checkpoint(),
  undo: () => {
    set({ editingId: null });
    history?.undo();
  },
  redo: () => {
    set({ editingId: null });
    history?.redo();
  },

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
    // Locked items are never deleted (unlock them first).
    ids = ids.filter((id) => !get().items[id]?.locked);
    if (!ids.length) return;
    // A mind map node goes with its whole branch.
    ids = withTreeChildren(ids, get().items).filter((id, i, all) => all.indexOf(id) === i && !get().items[id]?.locked);
    get().checkpoint();
    set((s) => {
      const gone = new Set(ids);
      const items = { ...s.items };
      for (const id of ids) delete items[id];
      const connectors = detachConnectors(s, gone);
      // Branch lines go with their nodes (they would be left as loose lines otherwise).
      for (const c of Object.values(s.connectors)) {
        if (c.branch && [c.from, c.to].some((e) => e.kind === 'item' && gone.has(e.itemId))) delete connectors[c.id];
      }
      return {
        items,
        connectors,
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
    set((s) => ({
      // Comment pins and folded-away mind map nodes aren't part of a selection.
      selected: [
        ...s.order.filter((id) => s.items[id]?.type !== 'comment' && !collapsedHidden(s.items).has(id)),
        ...Object.keys(s.connectors),
      ],
      editingId: null,
    })),
  startEditing: (id) => {
    if (get().readOnly) return;
    // A connector's text is its label.
    if (get().connectors[id]) {
      set({ editingId: id, selected: [id], tool: 'select' });
      return;
    }
    // Pen strokes and images have no text to edit.
    const it = get().items[id];
    if (!it || it.locked || it.type === 'path' || it.type === 'image' || it.type === 'emoji' || it.type === 'comment') return;
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
    // A new mind map node left empty (Enter / Tab, then Esc): drop it and its line, as part of its
    // creation's undo step.
    if (item.tree?.parent && !text.trim() && !item.text.trim() && !treeChildren(s.items).get(id)?.length) {
      set((st) => {
        const items = { ...st.items };
        delete items[id];
        const connectors = { ...st.connectors };
        for (const c of Object.values(st.connectors)) {
          if (c.branch && c.to.kind === 'item' && c.to.itemId === id) delete connectors[c.id];
        }
        // Its parent stays selected, ready for Tab.
        const parent = item.tree?.parent;
        return { items, connectors, order: st.order.filter((x) => x !== id), selected: parent && items[parent] ? [parent] : [] };
      });
      get().layoutDecks();
      return;
    }
    if (item.type === 'frame' && !text.trim()) text = 'Frame';
    const nextRich = rich === undefined ? item.rich : (rich ?? undefined);
    if (item.text === text && JSON.stringify(item.rich ?? null) === JSON.stringify(nextRich ?? null)) return;
    const patch: Partial<Item> = { text, rich: nextRich };
    // A class box or table grows taller so every row shows at its text size.
    const kind = shapeOf(item);
    if (item.type === 'rect' && isCompartmentShape(kind)) {
      const need = compartmentLayout(kind, text, item.fontSize, borderWidth(item)).height;
      if (need > item.h) patch.h = Math.ceil(need);
    }
    s.checkpoint();
    s.updateItems({ [id]: patch });
    // A mind map node may have grown: make room for it.
    if (item.tree) get().layoutDecks();
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
  nudge: (selection, dx, dy) => {
    const s = get();
    // Locked items stay put (a locked frame doesn't carry its contents).
    const sel = selection.filter((id) => !s.items[id]?.locked);
    if (!sel.length) return;
    // Frames carry their contents along.
    const ids = withFrameChildren(sel, s.items, s.order).filter((id) => !s.items[id]?.locked);
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
export function collect(s: BoardState, sel: string[]): Clip {
  // Copying a frame copies what is inside it too, and a mind map node its branch.
  const ids = [...new Set(withTreeChildren(withFrameChildren(sel, s.items, s.order), s.items))];
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
  const moved = clip.items.map((it) => {
    const id = uid();
    idMap.set(it.id, id);
    return { ...it, id, x: it.x + PASTE_OFFSET, y: it.y + PASTE_OFFSET };
  });
  // Mind map nodes point at their copied parents.
  const items = remapTrees(moved, idMap);
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
