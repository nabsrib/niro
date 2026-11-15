import { create } from 'zustand';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { useBoard, type BoardState } from '../store';
import { boundsOf, screenToWorld } from '../geometry';
import { glideTo } from '../cameraGlide';
import type { Box, Vec } from '../types';
import type { BoardDoc } from './boardDoc';
import { getUser, setUser, type LocalUser } from './user';

/**
 * The open board's connection to the collaboration server (server/index.mjs), and
 * presence: who else is on the board, where their cursor is, what they look at,
 * select and type in; plus following someone's view.
 *
 * The server passes Yjs updates between everyone on the board (applied here with
 * the provider as origin, so the bridge reads them into the store and undo leaves
 * them alone) and saves the board. Presence travels as Yjs "awareness": short-lived
 * state per person, never saved, dropped when they leave.
 * Server address: VITE_COLLAB_URL (in .env.local), or "off" for no server;
 * by default /collab on the page's own address (forwarded to the server by Vite).
 */

/** `denied`: the server refused this board (signed out, no access, deleted); see `deniedReason`. */
export type ConnectionStatus = 'off' | 'connecting' | 'online' | 'offline' | 'denied';

/** What the page tells you when the server refuses a board (reasons from server/index.mjs). */
export const DENIED_MESSAGE: Record<string, string> = {
  'signed-out': 'Sign in to keep this board in sync.',
  'no-access': 'You don’t have access to this board any more. Your copy here is kept, but it no longer syncs.',
  'not-found': 'This board is no longer on the server (it may have been deleted).',
};

/** A person's view: the world point at the center of their screen, and their zoom. */
export interface View {
  x: number;
  y: number;
  z: number;
}

/** What each person shares about themselves. */
export interface PresenceState {
  user: LocalUser;
  /** Cursor in world coordinates; null when it's off the board. */
  cursor: Vec | null;
  view: View | null;
  /** Selected item ids (up to MAX_SHARED_SELECTION; larger selections share `selectionBox`). */
  selection: string[];
  /** Bounds of a selection too large to share id by id. */
  selectionBox: Box | null;
  /** Item whose text they are typing in. */
  editing: string | null;
  /** In the middle of a drag (move, resize...). */
  busy: boolean;
  /** "Bring everyone to me": when they started it (their clock), null when not leading. */
  lead: number | null;
  /** Whom they follow (that person's awareness id), or null. */
  follows: number | null;
}

/** Someone else on the board. `seen`: when their cursor last moved (local clock). */
export interface Peer extends PresenceState {
  id: number;
  seen: number;
}

interface Presence {
  status: ConnectionStatus;
  deniedReason: string | null;
  peers: Peer[];
  me: LocalUser;
  /** The person whose view this one follows. */
  following: number | null;
  /** This person brought everyone to their view. */
  leading: boolean;
}

export const usePresence = create<Presence>(() => ({
  status: 'off',
  deniedReason: null,
  peers: [],
  me: getUser(),
  following: null,
  leading: false,
}));

const MAX_SHARED_SELECTION = 200;

export function collabUrl(): string | null {
  const env = import.meta.env.VITE_COLLAB_URL as string | undefined;
  if (env === 'off') return null;
  if (env) return env;
  // Through the page's own address: the Vite dev server forwards /collab to the niro server.
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`;
}

const STATUS: Record<string, ConnectionStatus> = {
  connecting: 'connecting',
  connected: 'online',
  disconnected: 'offline',
};

/** The open board's awareness, for publishing this person's presence. */
let active: Awareness | null = null;

function currentView(): View {
  const { camera, viewport } = useBoard.getState();
  const c = screenToWorld({ x: viewport.w / 2, y: viewport.h / 2 }, camera);
  return { x: c.x, y: c.y, z: camera.z };
}

function selectionOf(s: BoardState): Pick<PresenceState, 'selection' | 'selectionBox'> {
  const ids = s.selected.filter((id) => s.items[id]);
  if (ids.length <= MAX_SHARED_SELECTION) return { selection: ids, selectionBox: null };
  return { selection: [], selectionBox: boundsOf(ids.map((id) => s.items[id])) };
}

// ---------- following ----------

/** Following started because that person brought everyone to them (stops when they stop). */
let followByLead = false;
/** Last view applied while following, to glide only when it changes. */
let followedView = '';

/** Move this view to `v` (their screen center and zoom, on this screen). */
function showView(v: View, ms?: number) {
  const { viewport } = useBoard.getState();
  glideTo({ x: viewport.w / 2 - v.x * v.z, y: viewport.h / 2 - v.y * v.z, z: v.z }, viewport, ms);
}

/** This person's awareness id on the open board (null when not connected). */
export function myId(): number | null {
  return active?.clientID ?? null;
}

/**
 * Follow someone's view (null = stop). Panning, zooming or clicking the board stops
 * it too. Never follows someone who follows this person (they would chase each other).
 */
export function follow(id: number | null, byLead = false) {
  const target = id === null ? null : usePresence.getState().peers.find((p) => p.id === id);
  if (target && target.follows !== null && target.follows === myId()) {
    useBoard.getState().showNotice(`${target.user.name} is following you, so you can't follow them back.`);
    return;
  }
  followByLead = id !== null && byLead;
  followedView = '';
  usePresence.setState({ following: id });
  publish('follows', id);
  const peer = id === null ? null : usePresence.getState().peers.find((p) => p.id === id);
  if (peer?.view) {
    followedView = JSON.stringify(peer.view);
    showView(peer.view);
  }
}

/** Start or stop bringing everyone to this view (they follow until it stops or they move). */
export function setLead(on: boolean) {
  if (on && usePresence.getState().following !== null) follow(null);
  usePresence.setState({ leading: on });
  publish('lead', on ? Date.now() : null);
}

/**
 * Connect the open board to the server and share presence. Returns a function
 * that disconnects (others then see this person leave).
 */
export function connectBoard(boardId: string, bd: BoardDoc): () => void {
  const url = collabUrl();
  if (!url) {
    usePresence.setState({ status: 'off', peers: [], following: null, leading: false });
    return () => {};
  }
  usePresence.setState({ status: 'connecting', deniedReason: null, peers: [], following: null, leading: false });
  const provider = new HocuspocusProvider({
    url,
    name: boardId,
    document: bd.doc,
    onStatus: ({ status }) => {
      // A refused board stays "denied" until it is opened again.
      if (usePresence.getState().status !== 'denied') usePresence.setState({ status: STATUS[String(status)] ?? 'offline' });
    },
    // The server's word on what you may do: viewers get a read-only connection.
    onAuthenticated: ({ scope }) => {
      usePresence.setState({ status: 'online', deniedReason: null });
      useBoard.setState(scope === 'readonly' ? { readOnly: true, tool: 'select', editingId: null } : { readOnly: false });
    },
    onAuthenticationFailed: ({ reason }) => {
      usePresence.setState({ status: 'denied', deniedReason: reason, peers: [] });
      useBoard.getState().showNotice(DENIED_MESSAGE[reason] ?? `The server refused this board (${reason}).`, 'error');
    },
  });
  const awareness = provider.awareness!;
  const s0 = useBoard.getState();
  const mine: PresenceState = {
    user: usePresence.getState().me,
    cursor: null,
    view: currentView(),
    ...selectionOf(s0),
    editing: s0.editingId,
    busy: false,
    lead: null,
    follows: null,
  };
  awareness.setLocalState(mine);

  const seen = new Map<number, { key: string; at: number }>();
  const leadSeen = new Map<number, number>();
  const onChange = () => {
    const now = Date.now();
    const peers: Peer[] = [];
    awareness.getStates().forEach((state, id) => {
      if (id === awareness.clientID) return;
      const st = state as Partial<PresenceState>;
      if (!st.user) return;
      // A cursor that hasn't moved keeps its `seen` time, so it can fade.
      const key = st.cursor ? `${st.cursor.x},${st.cursor.y}` : '';
      const prev = seen.get(id);
      const at = prev && prev.key === key ? prev.at : now;
      seen.set(id, { key, at });
      peers.push({
        id,
        user: st.user,
        cursor: st.cursor ?? null,
        view: st.view ?? null,
        selection: st.selection ?? [],
        selectionBox: st.selectionBox ?? null,
        editing: st.editing ?? null,
        busy: !!st.busy,
        lead: st.lead ?? null,
        follows: st.follows ?? null,
        seen: at,
      });
    });
    usePresence.setState({ peers });
    const { showNotice } = useBoard.getState();

    // Someone just brought everyone to them: follow (unless this person leads too).
    for (const p of peers) {
      if (p.lead === null) leadSeen.delete(p.id);
      else if (leadSeen.get(p.id) !== p.lead) {
        leadSeen.set(p.id, p.lead);
        if (!usePresence.getState().leading) {
          follow(p.id, true);
          showNotice(`${p.user.name} brought everyone to their view. Pan or press Esc to look around.`);
        }
      }
    }

    // Keep up with the person being followed.
    const following = usePresence.getState().following;
    if (following === null) return;
    const peer = peers.find((p) => p.id === following);
    if (!peer) {
      follow(null);
      showNotice('The person you were following left the board.');
    } else if (followByLead && peer.lead === null) {
      follow(null);
    } else if (peer.follows === awareness.clientID && awareness.clientID > peer.id) {
      // Both started following each other at the same moment: one of them (the
      // same one on both sides, by id) lets go.
      follow(null);
      showNotice(`${peer.user.name} started following you at the same moment, so you stopped following them.`);
    } else if (peer.view && JSON.stringify(peer.view) !== followedView) {
      followedView = JSON.stringify(peer.view);
      showView(peer.view, 150);
    }
  };
  awareness.on('change', onChange);

  const unsubscribe = useBoard.subscribe((s, prev) => {
    if (s.camera !== prev.camera || s.viewport !== prev.viewport) publish('view', currentView());
    if (s.selected !== prev.selected || s.items !== prev.items) {
      const sel = selectionOf(s);
      const cur = active?.getLocalState() as Partial<PresenceState> | null;
      if (JSON.stringify(sel) !== JSON.stringify({ selection: cur?.selection, selectionBox: cur?.selectionBox })) {
        publish('selection', sel.selection);
        publish('selectionBox', sel.selectionBox);
      }
    }
    if (s.editingId !== prev.editingId) {
      publish('editing', s.editingId);
      const other = s.editingId && usePresence.getState().peers.find((p) => p.editing === s.editingId);
      if (other) s.showNotice(`${other.user.name} is typing here too: whoever finishes last keeps their text.`);
    }
    if (s.interacting !== prev.interacting) publish('busy', s.interacting);
    // A presentation that brought everyone along lets them go when it ends.
    if (prev.presenting && !s.presenting && usePresence.getState().leading) setLead(false);
  });
  active = awareness;

  return () => {
    active = null;
    followedView = '';
    window.clearTimeout(timer);
    timer = undefined;
    pending.clear();
    unsubscribe();
    awareness.off('change', onChange);
    provider.destroy();
    followByLead = false;
    usePresence.setState({ status: 'off', deniedReason: null, peers: [], following: null, leading: false });
  };
}

/** The open board has no server connection (a board kept only in this browser). */
export function noConnection() {
  usePresence.setState({ status: 'off', deniedReason: null, peers: [], following: null, leading: false });
}

/**
 * Send a board that isn't open to the server (moving boards from this browser
 * into an account). Resolves true once the server has all of it, false if it was
 * refused or took longer than `timeoutMs`.
 */
export function uploadBoard(boardId: string, doc: Y.Doc, timeoutMs = 15_000): Promise<boolean> {
  const url = collabUrl();
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      provider.destroy();
      resolve(ok);
    };
    const provider = new HocuspocusProvider({
      url,
      name: boardId,
      document: doc,
      onAuthenticationFailed: () => finish(false),
    });
    // Synced (the server answered) and nothing left unacknowledged = uploaded.
    const poll = window.setInterval(() => {
      if (provider.synced && !provider.hasUnsyncedChanges) finish(true);
    }, 150);
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
  });
}

// ---------- publishing presence (at most every 50 ms) ----------

const THROTTLE_MS = 50;
const pending = new Map<keyof PresenceState, unknown>();
let timer: number | undefined;
let lastSent = 0;

function publish(field: keyof PresenceState, value: unknown) {
  if (!active) return;
  pending.set(field, value);
  if (timer !== undefined) return;
  timer = window.setTimeout(flush, Math.max(0, lastSent + THROTTLE_MS - Date.now()));
}

function flush() {
  timer = undefined;
  if (!active) return pending.clear();
  lastSent = Date.now();
  active.setLocalState({ ...(active.getLocalState() ?? {}), ...Object.fromEntries(pending) });
  pending.clear();
}

/** Share this person's cursor (world coordinates), or null when it leaves the board. */
export function publishCursor(p: Vec | null) {
  publish('cursor', p && { x: Math.round(p.x), y: Math.round(p.y) });
}

/** Change this person's name (remembered in this browser, shown to others right away). */
export function renameMe(name: string) {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  const me = setUser({ name: clean });
  usePresence.setState({ me });
  publish('user', me);
}
