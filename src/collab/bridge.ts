import * as Y from 'yjs';
import { setHistory, useBoard, type BoardState } from '../store';
import type { Connector, Endpoint, Item } from '../types';
import { assignZ, sortByZ } from '../zorder';
import { resolveConnector } from '../connectors';
import { Z, fieldEntries, readFields, writeFields, zOf, type BoardDoc, type DocContent } from './boardDoc';
import { usePresence } from './connection';

/** Origin of the document changes this tab makes from store changes. */
export const LOCAL = 'niro-local';
/**
 * Origin of automatic fixes this tab writes after changes from elsewhere (deck
 * layout, repaired connectors): shared like any change, but never an undo step.
 */
export const FIX = 'niro-fix';

/** Origin the next store → document write uses (FIX inside `asFix`). */
let pushOrigin = LOCAL;

/** Run a store change whose document writes are an automatic fix, not an undo step. */
export function asFix(fn: () => void) {
  const prev = pushOrigin;
  pushOrigin = FIX;
  try {
    fn();
  } finally {
    pushOrigin = prev;
  }
}

/** Wait this long after the last frame change from elsewhere before re-laying out decks. */
const DECK_FIX_DELAY = 400;

const pick = (s: BoardState): DocContent => ({ items: s.items, order: s.order, connectors: s.connectors });
const own = (origin: unknown) => origin === LOCAL || origin === FIX;

/**
 * Keep the store and a board's Yjs document in step, both ways:
 * - Local: any store change that replaces `items`, `order` or `connectors` (every
 *   action works that way) is compared by reference with the last synced content,
 *   and only what changed is written to the document, in one transaction. Actions
 *   don't need to know about Yjs.
 * - Elsewhere: document changes not made here (later: other tabs, other people)
 *   are read back into the store, reusing the unchanged objects.
 * Fixes after changes from elsewhere (written with origin FIX):
 * - A connector attached to an item that is gone (one person deleted the item
 *   while another attached to it) gets a free end where the item was, like
 *   `deleteItems` does; if this tab never saw the item, the connector is removed.
 *   Until fixed, such connectors are left out of the store.
 * - Slide decks are laid out again after frames change elsewhere (two people
 *   adding slides at once), once nobody is dragging.
 * Call after the store holds the document's content. Returns a function that stops it.
 */
export function bindBoard(bd: BoardDoc): () => void {
  let last = pick(useBoard.getState());
  let applying = false;
  /** Items removed by changes from elsewhere, kept to place detached connector ends. */
  const gone = new Map<string, Item>();
  let deckTimer: number | undefined;
  let stopped = false;

  let warnedAt = 0;
  const unsubscribe = useBoard.subscribe((s) => {
    if (applying) return;
    if (s.items === last.items && s.order === last.order && s.connectors === last.connectors) return;
    if (s.readOnly) {
      // View only: put the content back, so nothing is saved or sent (the server
      // would refuse it anyway), and say why now and then.
      applying = true;
      try {
        useBoard.setState({ items: last.items, order: last.order, connectors: last.connectors });
      } finally {
        applying = false;
      }
      if (Date.now() - warnedAt > 4000) {
        warnedAt = Date.now();
        s.showNotice('This board is view only.');
      }
      return;
    }
    const next = pick(s);
    const prev = last;
    last = next;
    bd.doc.transact(() => push(bd, prev, next), pushOrigin);
  });

  /** Give dangling connectors free ends (or remove them), as one shared fix. */
  const repairConnectors = () => {
    if (stopped || useBoard.getState().readOnly) return;
    const known: Record<string, Item> = { ...Object.fromEntries(gone), ...last.items };
    const fixed: Record<string, Connector> = {};
    const remove: string[] = [];
    bd.connectors.forEach((m, id) => {
      const c = readFields<Connector>(id, m);
      const lost = (e: Endpoint) => e.kind === 'item' && !bd.items.has(e.itemId);
      if (!lost(c.from) && !lost(c.to)) return;
      const r = resolveConnector(c, known);
      if (!r) return void remove.push(id);
      fixed[id] = {
        ...c,
        from: lost(c.from) ? { kind: 'point', x: r.a.x, y: r.a.y } : c.from,
        to: lost(c.to) ? { kind: 'point', x: r.b.x, y: r.b.y } : c.to,
      };
    });
    gone.clear();
    if (remove.length) bd.doc.transact(() => remove.forEach((id) => bd.connectors.delete(id)), FIX);
    if (Object.keys(fixed).length) {
      asFix(() => useBoard.setState((s) => ({ connectors: { ...s.connectors, ...fixed } })));
    }
  };

  /** Lay out decks again, once neither this person nor anyone else is dragging. */
  const scheduleDeckFix = () => {
    window.clearTimeout(deckTimer);
    deckTimer = window.setTimeout(() => {
      if (stopped || useBoard.getState().readOnly) return;
      const busy = useBoard.getState().interacting || usePresence.getState().peers.some((p) => p.busy);
      if (busy) return scheduleDeckFix();
      asFix(() => useBoard.getState().layoutDecks());
    }, DECK_FIX_DELAY);
  };

  /** Read changed items and connectors from the document into the store. */
  const apply = (itemIds: Set<string>, connectorIds: Set<string>, reorder: boolean) => {
    let items = last.items;
    let itemSetChanged = false;
    let framesChanged = false;
    if (itemIds.size) {
      items = { ...items };
      for (const id of itemIds) {
        const m = bd.items.get(id);
        const old = items[id];
        if (m) {
          if (!old) itemSetChanged = true;
          items[id] = readFields<Item>(id, m);
          if (items[id].type === 'frame') framesChanged = true;
        } else if (old) {
          delete items[id];
          gone.set(id, old);
          itemSetChanged = true;
          if (old.type === 'frame') framesChanged = true;
        }
      }
    }
    const order = reorder || itemSetChanged ? sortByZ(Object.keys(items), (id) => zOf(bd, id) ?? 0) : last.order;

    let connectors = last.connectors;
    let dangling = false;
    if (connectorIds.size || itemSetChanged) {
      const has = (e: Endpoint) => e.kind === 'point' || !!items[e.itemId];
      connectors = {};
      bd.connectors.forEach((m, id) => {
        const old = last.connectors[id];
        const c = old && !connectorIds.has(id) ? old : readFields<Connector>(id, m);
        if (has(c.from) && has(c.to)) connectors[id] = c;
        else dangling = true;
      });
    }

    const s = useBoard.getState();
    const exists = (id: string) => !!items[id] || !!connectors[id];
    if (s.editingId && !exists(s.editingId)) {
      s.showNotice('Someone else deleted what you were editing.', 'error');
    }
    // Fixes write to the document, so they run after this change has been applied.
    if (dangling) queueMicrotask(repairConnectors);
    if (framesChanged) scheduleDeckFix();
    last = { items, order, connectors };
    applying = true;
    try {
      useBoard.setState({
        items,
        order,
        connectors,
        selected: s.selected.filter(exists),
        editingId: s.editingId && exists(s.editingId) ? s.editingId : null,
        focusId: s.focusId && items[s.focusId] ? s.focusId : null,
      });
    } finally {
      applying = false;
    }
  };

  // Yjs types deep events loosely (YEvent<any>); each one here is a Y.Map event.
  const onItems = (events: Y.YEvent<any>[], tr: Y.Transaction) => {
    if (own(tr.origin)) return;
    const ids = new Set<string>();
    let reorder = false;
    for (const ev of events) {
      if (ev.target === bd.items) {
        // Items added, removed or replaced.
        for (const id of (ev as Y.YMapEvent<unknown>).keysChanged) ids.add(id);
        reorder = true;
      } else {
        // Fields of one item changed.
        ids.add(String(ev.path[0]));
        if ((ev as Y.YMapEvent<unknown>).keysChanged.has(Z)) reorder = true;
      }
    }
    apply(ids, new Set(), reorder);
  };

  const onConnectors = (events: Y.YEvent<any>[], tr: Y.Transaction) => {
    if (own(tr.origin)) return;
    const ids = new Set<string>();
    for (const ev of events) {
      if (ev.target === bd.connectors) for (const id of (ev as Y.YMapEvent<unknown>).keysChanged) ids.add(id);
      else ids.add(String(ev.path[0]));
    }
    apply(new Set(), ids, false);
  };

  bd.items.observeDeep(onItems);
  bd.connectors.observeDeep(onConnectors);
  const stopHistory = bindHistory(bd);
  // A board saved with dangling connectors (fixed elsewhere later) gets them fixed now.
  queueMicrotask(repairConnectors);
  return () => {
    stopped = true;
    window.clearTimeout(deckTimer);
    stopHistory();
    unsubscribe();
    bd.items.unobserveDeep(onItems);
    bd.connectors.unobserveDeep(onConnectors);
  };
}

/** Undo steps kept, oldest dropped first. */
const HISTORY_LIMIT = 200;

/**
 * Undo for the open board: a Yjs UndoManager that only records this tab's own
 * changes (origin LOCAL), so undo never reverts someone else's work. Grouping by
 * time is off: `checkpoint()` starts each step, as before. An undo writes to the
 * document with the UndoManager as origin, so the bridge reads it back into the store.
 */
function bindHistory(bd: BoardDoc): () => void {
  const um = new Y.UndoManager([bd.items, bd.connectors], {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: Infinity,
  });
  const syncFlags = () => {
    const canUndo = um.undoStack.length > 0;
    const canRedo = um.redoStack.length > 0;
    const s = useBoard.getState();
    if (s.canUndo !== canUndo || s.canRedo !== canRedo) useBoard.setState({ canUndo, canRedo });
  };
  const onAdded = () => {
    if (um.undoStack.length > HISTORY_LIMIT) um.undoStack.shift();
    syncFlags();
  };
  um.on('stack-item-added', onAdded);
  um.on('stack-item-popped', syncFlags);
  um.on('stack-cleared', syncFlags);
  setHistory({
    checkpoint: () => um.stopCapturing(),
    undo: () => {
      um.undo();
    },
    redo: () => {
      um.redo();
    },
    clear: () => um.clear(),
  });
  syncFlags();
  return () => {
    setHistory(null);
    um.destroy();
  };
}

/** Write the difference between two store contents to the document. */
function push(bd: BoardDoc, prev: DocContent, next: DocContent) {
  if (next.items !== prev.items) syncMap(bd.items, prev.items, next.items);
  if (next.connectors !== prev.connectors) syncMap(bd.connectors, prev.connectors, next.connectors);
  // New items always change the order too, so they get their z here.
  if (next.order !== prev.order) {
    for (const [id, z] of assignZ(next.order, (id) => zOf(bd, id))) bd.items.get(id)?.set(Z, z);
  }
}

function syncMap<T extends object>(root: Y.Map<Y.Map<unknown>>, prev: Record<string, T>, next: Record<string, T>) {
  for (const id in next) {
    const n = next[id];
    const p = prev[id];
    if (n === p) continue;
    const m = root.get(id);
    if (!m) root.set(id, new Y.Map<unknown>(fieldEntries(n)));
    else writeFields(m, n, p ?? m.toJSON());
  }
  for (const id in prev) if (!(id in next)) root.delete(id);
}
