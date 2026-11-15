import * as Y from 'yjs';
import type { BoardDoc } from './boardDoc';

/** Origin of document changes received from another tab. */
export const TAB = 'niro-tab';

/**
 * Messages between tabs that have the same board open:
 * - `hello`: a tab just opened the board and says what it has (its state vector)
 * - `reply`: an open tab answers one `hello` with what that tab is missing, and
 *   says what it has itself, so the new tab can send back what *it* is missing
 * - `update`: a change made in one tab (its own edits, undo / redo)
 */
type Msg =
  | { type: 'hello'; from: string; sv: Uint8Array }
  | { type: 'reply'; to: string; sv: Uint8Array; update: Uint8Array }
  | { type: 'update'; update: Uint8Array };

/** Smallest Yjs update (nothing in it). */
const EMPTY_UPDATE = 2;

/**
 * Keep the open board's document in step with other tabs of this browser that
 * have the same board open, with no server: changes travel over a
 * BroadcastChannel as Yjs updates and merge, so tabs never overwrite each other.
 * Received changes are applied with origin TAB; the bridge reads them into the
 * store, and undo leaves them alone (it only records this tab's own changes).
 * Returns a function that stops it.
 */
export function bindTabSync(boardId: string, bd: BoardDoc): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const me = Math.random().toString(36).slice(2);
  const channel = new BroadcastChannel(`niro:board:${boardId}`);
  const send = (m: Msg) => channel.postMessage(m);

  // Pass on every change made here; never echo one that came from another tab.
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== TAB) send({ type: 'update', update });
  };

  channel.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (m.type === 'update') {
      Y.applyUpdate(bd.doc, m.update, TAB);
    } else if (m.type === 'hello') {
      send({ type: 'reply', to: m.from, sv: Y.encodeStateVector(bd.doc), update: Y.encodeStateAsUpdate(bd.doc, m.sv) });
    } else if (m.type === 'reply' && m.to === me) {
      Y.applyUpdate(bd.doc, m.update, TAB);
      // Changes made here (or saved here) that the other tab hasn't seen yet.
      const missing = Y.encodeStateAsUpdate(bd.doc, m.sv);
      if (missing.length > EMPTY_UPDATE) send({ type: 'update', update: missing });
    }
  };

  bd.doc.on('update', onUpdate);
  send({ type: 'hello', from: me, sv: Y.encodeStateVector(bd.doc) });
  return () => {
    bd.doc.off('update', onUpdate);
    channel.close();
  };
}
