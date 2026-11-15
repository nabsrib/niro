import { useBoard } from './store';
import { openKV, type KV } from './kv';
import { loadLegacyBoard, sanitizeBoard } from './persistence';
import { commitActiveEdit } from './editing';
import { readBoardFile } from './boardFile';
import { uid } from './geometry';
import type { BoardMeta, Camera } from './types';
import {
  createBoardDoc,
  decodeIntoBoardDoc,
  encodeBoardDoc,
  fillBoardDoc,
  isFilled,
  readBoard,
  type BoardDoc,
} from './collab/boardDoc';
import { bindBoard } from './collab/bridge';
import { bindTabSync } from './collab/tabSync';
import { connectBoard, noConnection, uploadBoard, usePresence } from './collab/connection';
import { openAccountDialog, useAccount } from './account';
import { ApiError, boardsApi, type ServerBoard } from './api';

/**
 * Multiple boards. Storage keys (IndexedDB, or localStorage as a fallback):
 * - `boards`: the list of boards (`BoardMeta[]`)
 * - `current`: id of the board that was open last
 * - `ydoc:<id>`: one board's content, as a Yjs document (collab/boardDoc.ts)
 * - `camera:<id>`: your view of that board (not part of the shared content)
 * - `board:<id>`: the board as saved before Yjs (`SavedBoard`). Read once, the
 *   first time the board opens, to fill its document; then kept as a backup.
 * The open board's document is bound to the store (collab/bridge.ts) and
 * autosaves 300 ms after each change. The URL hash (`#board=<id>`) keeps the
 * same board open across reloads. Tabs of this browser stay in step: the open
 * board's changes through collab/tabSync.ts, the boards list through the
 * `niro:boards` BroadcastChannel.
 *
 * Accounts: signed in, the list is your account's boards from the server
 * (`role` set; they sync live) plus boards still only in this browser (no
 * `role`; offered to move into the account on sign-in, or from the menu). New
 * boards are created on the server. Signing out removes the account's boards
 * from this browser (they stay on the server). A link to a board you don't have
 * asks the server whether you may open it.
 */

let kv: KV;
const docKey = (id: string) => `ydoc:${id}`;
const cameraKey = (id: string) => `camera:${id}`;
const boardKey = (id: string) => `board:${id}`;
const SAVE_DELAY = 300;
const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The open board: its document and how to stop syncing it with the store. */
let current: { id: string; bd: BoardDoc; stop: () => void } | null = null;

const newMeta = (name: string): BoardMeta => {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now };
};

const fromServer = (b: ServerBoard, account: string): BoardMeta => ({
  id: b.id,
  name: b.name,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
  role: b.role,
  account,
  linkAccess: b.linkAccess,
  ownerName: b.ownerName,
});

const signedInUser = () => {
  const a = useAccount.getState();
  return a.status === 'signed-in' ? a.user : null;
};

const notice = (text: string, kind: 'info' | 'error' = 'info') => useBoard.getState().showNotice(text, kind);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const hashId = () => /(?:^#|&)board=([^&]+)/.exec(window.location.hash)?.[1];
const setHash = (id: string) => {
  if (hashId() !== id) history.replaceState(null, '', `#board=${id}`);
};

/** Tells other tabs when the boards list changes (null where BroadcastChannel is missing). */
let boardsChannel: BroadcastChannel | null = null;

async function saveIndex(boards: BoardMeta[]) {
  useBoard.getState().setBoards(boards);
  await kv.set('boards', boards);
  boardsChannel?.postMessage(boards);
}

/** Drop a board's data from this browser. */
async function forget(id: string) {
  for (const key of [docKey, cameraKey, boardKey]) await kv.del(key(id));
}

/**
 * Another tab changed the boards list (new, renamed, deleted, last edited). If it
 * deleted the board open here, open another one, without saving the deleted one.
 */
function onBoardsChanged(boards: BoardMeta[]) {
  const s = useBoard.getState();
  s.setBoards(boards);
  if (!s.boardId || boards.some((b) => b.id === s.boardId) || !boards.length) return;
  close();
  void open(boards[0].id, boards).then(() => notice('That board was removed in another tab.', 'error'));
}

/**
 * Read a board's document from storage. A board that has none yet (saved by an
 * older version, or new) gets one, filled from its old save; returns that old
 * save's camera too, and whether the new document still needs saving.
 */
async function loadDoc(id: string): Promise<{ bd: BoardDoc; camera?: Camera; fresh: boolean }> {
  const bd = createBoardDoc();
  const raw = await kv.get<unknown>(docKey(id));
  try {
    if (decodeIntoBoardDoc(bd, raw) && isFilled(bd)) return { bd, fresh: false };
  } catch {
    // Broken data: keep it aside for inspection and fall back to the old save.
    await kv.set(`${docKey(id)}:broken`, raw);
    notice('This board was damaged in storage; it was restored from an older copy.', 'error');
  }
  const old = sanitizeBoard(await kv.get(boardKey(id)));
  const fresh = createBoardDoc();
  bd.doc.destroy();
  fillBoardDoc(fresh, old);
  return { bd: fresh, camera: old?.camera, fresh: true };
}

/** Stop syncing the open board and drop its document (save it first with flushSave). */
function close() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  docDirty = false;
  cameraDirty = false;
  current?.stop();
  current = null;
}

/**
 * Load a board from storage into the store and remember it as the open one.
 * Boards kept with an account connect to the server (which also decides whether
 * you may edit); boards only in this browser don't.
 */
async function open(id: string, boards: BoardMeta[]) {
  close();
  const meta = boards.find((b) => b.id === id);
  const { bd, camera: oldCamera, fresh } = await loadDoc(id);
  const camera = (await kv.get<Camera>(cameraKey(id))) ?? oldCamera;
  const data = sanitizeBoard({ ...readBoard(bd), camera });
  useBoard.setState(meta?.role === 'viewer' ? { readOnly: true, tool: 'select' } : { readOnly: false });
  useBoard.getState().loadBoardData(data, id, boards);
  const unbind = bindBoard(bd);
  // Every change saves, also those from other tabs: whichever tab closes first,
  // nothing is lost (both tabs hold the same merged document).
  const onUpdate = () => {
    docDirty = true;
    scheduleSave();
  };
  bd.doc.on('update', onUpdate);
  const stopTabs = bindTabSync(id, bd);
  let stopServer = () => {};
  if (meta?.role) stopServer = connectBoard(id, bd);
  else noConnection();
  current = {
    id,
    bd,
    stop: () => {
      stopServer();
      stopTabs();
      unbind();
      bd.doc.off('update', onUpdate);
      bd.doc.destroy();
    },
  };
  if (fresh) onUpdate();
  setHash(id);
  await kv.set('current', id);
}

/** Open a board again (after its role changed, or it moved into the account). */
async function reopen(id: string) {
  commitActiveEdit();
  await flushSave();
  await open(id, useBoard.getState().boards);
}

/**
 * Called once before the app renders: opens storage, moves the old single
 * board (localStorage) into the boards list on first run, and opens the board
 * from the URL, the last open one, or the first.
 */
export async function initBoards(): Promise<void> {
  kv = await openKV();
  if (typeof BroadcastChannel !== 'undefined') {
    boardsChannel = new BroadcastChannel('niro:boards');
    boardsChannel.onmessage = (e: MessageEvent<BoardMeta[]>) => onBoardsChanged(e.data);
  }
  let boards = (await kv.get<BoardMeta[]>('boards')) ?? [];
  if (!boards.length) {
    const meta = newMeta('My board');
    const legacy = loadLegacyBoard();
    if (legacy) await kv.set(boardKey(meta.id), legacy);
    boards = [meta];
    await kv.set('boards', boards);
  }
  const fromLink = hashId();
  // A link to a board not in this browser: ask the server once we know who is signed in.
  if (fromLink && !boards.some((b) => b.id === fromLink)) pendingLink = fromLink;
  const last = await kv.get<string>('current');
  const id = [fromLink, last].find((x) => x && boards.some((b) => b.id === x)) ?? boards[0].id;
  await open(id, boards);
  startAutosave();
  // Editing the URL hash by hand (or back/forward, or pasting a shared link) switches boards.
  window.addEventListener('hashchange', () => {
    const target = hashId();
    if (target && target !== useBoard.getState().boardId) void openLink(target);
  });
  watchAccount();
  if (kv.kind === 'localstorage') {
    notice('This browser blocked the board database, so boards are kept in smaller storage.', 'error');
  }
  // Handy for debugging in the browser console during development.
  if (import.meta.env.DEV) (window as unknown as { boardDoc: () => BoardDoc | undefined }).boardDoc = () => current?.bd;
}

// ---------- autosave ----------

let saveTimer: number | undefined;
let docDirty = false;
let cameraDirty = false;
let warnedFull = false;

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void saveCurrent();
  }, SAVE_DELAY);
}

/** Save what changed on the open board now: its document and/or your camera. */
async function saveCurrent() {
  const cur = current;
  if (!cur) return;
  const s = useBoard.getState();
  const saveDoc = docDirty;
  const saveCamera = cameraDirty;
  docDirty = false;
  cameraDirty = false;
  try {
    if (saveDoc) {
      await kv.set(docKey(cur.id), encodeBoardDoc(cur.bd, kv.kind === 'localstorage'));
      const boards = useBoard.getState().boards.map((b) => (b.id === cur.id ? { ...b, updatedAt: Date.now() } : b));
      await saveIndex(boards);
    }
    if (saveCamera) await kv.set(cameraKey(cur.id), s.camera);
    warnedFull = false;
  } catch {
    // Try again with the next change; a failed save is never silent.
    if (current === cur) {
      docDirty ||= saveDoc;
      cameraDirty ||= saveCamera;
    }
    if (!warnedFull) {
      warnedFull = true;
      s.showNotice('Could not save the board: browser storage is full or blocked. Export it as JSON to keep a copy.', 'error');
    }
  }
}

/** Save right away if a save is waiting (before switching boards or leaving). */
async function flushSave() {
  if (saveTimer === undefined) return;
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  await saveCurrent();
}

function startAutosave() {
  // Content saves through the document's updates (see open); the camera through the store.
  useBoard.subscribe((s, prev) => {
    if (s.boardId !== prev.boardId || s.camera === prev.camera) return;
    cameraDirty = true;
    scheduleSave();
  });
  // Don't lose the last change when the tab is closed or hidden.
  const onHide = () => void flushSave();
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && onHide());
}

// ---------- accounts ----------

/** A board link waiting until we know who is signed in. */
let pendingLink: string | null = null;
/** The account the list was last set up for (undefined until the session is known). */
let knownUser: string | null | undefined;
let lastRefresh = 0;

function watchAccount() {
  useAccount.subscribe((a, prev) => {
    if (a.status !== prev.status || a.user?.id !== prev.user?.id) void onAccountChanged();
  });
  void onAccountChanged();
  // Pick up boards shared with you, renames and removals made elsewhere.
  window.addEventListener('focus', () => {
    if (Date.now() - lastRefresh > 10_000) void refreshBoards();
  });
  // Refused by the server (access removed, board deleted): update the list.
  usePresence.subscribe((p, prev) => {
    if (p.status === 'denied' && prev.status !== 'denied' && p.deniedReason !== 'signed-out') void refreshBoards();
  });
}

async function onAccountChanged() {
  const a = useAccount.getState();
  // Unknown who is signed in (still loading, or server unreachable): change nothing.
  if (a.status === 'loading' || a.status === 'offline') return;
  const userId = a.user?.id ?? null;
  if (userId === knownUser) return;
  const before = knownUser;
  knownUser = userId;
  if (userId) {
    // Offer to move local boards only right after signing in, not on every page load.
    await syncAccountBoards(before === null);
    if (pendingLink) {
      const id = pendingLink;
      pendingLink = null;
      await openLink(id);
    }
  } else {
    await dropServerBoards();
    if (pendingLink) {
      notice('Sign in to open the board you were sent.');
      openAccountDialog('sign-in');
    }
  }
}

/** Load your account's boards from the server again (names, new shares, removals). */
export async function refreshBoards() {
  if (signedInUser()) await syncAccountBoards(false);
}

/**
 * Make the list your account's boards plus the boards only in this browser.
 * Boards of another account (signed in as someone else here before) and boards
 * you no longer have are removed from this browser.
 */
async function syncAccountBoards(offerMove: boolean) {
  const user = signedInUser();
  if (!user) return;
  lastRefresh = Date.now();
  let list: ServerBoard[];
  try {
    list = await boardsApi.list();
  } catch {
    return; // server unreachable: keep what this browser has
  }
  const s = useBoard.getState();
  const serverIds = new Set(list.map((b) => b.id));
  const removed = s.boards.filter((b) => b.role && (b.account !== user.id || !serverIds.has(b.id)));
  for (const b of removed) await forget(b.id);
  let next = [
    ...list.map((b) => fromServer(b, user.id)),
    ...s.boards.filter((b) => !b.role && !serverIds.has(b.id)),
  ];
  if (!next.length) next = [await newBoardMeta('My board', [])];
  const openBefore = s.boards.find((b) => b.id === s.boardId);
  const openNow = next.find((b) => b.id === s.boardId);
  if (!openNow) close(); // removed: don't save it again
  await saveIndex(next);
  if (!openNow) {
    await open(next[0].id, next);
    if (openBefore?.role) notice('That board is no longer available to you.', 'error');
  } else if (openBefore?.role !== openNow.role) {
    await reopen(openNow.id);
  }
  if (offerMove) {
    const local = next.filter((b) => !b.role);
    const names = local.map((b) => `"${b.name}"`).join(', ');
    if (local.length && window.confirm(`Move ${local.length} board(s) from this browser into your account?\n\n${names}\n\nThey will sync and can be shared. Cancel keeps them only in this browser (you can move them later from the boards menu).`)) {
      await moveLocalBoards(local.map((b) => b.id));
    }
  }
}

/** Signed out: remove the account's boards from this browser (they stay on the server). */
async function dropServerBoards() {
  const s = useBoard.getState();
  const server = s.boards.filter((b) => b.role);
  if (!server.length) return;
  for (const b of server) await forget(b.id);
  let next = s.boards.filter((b) => !b.role);
  const openRemoved = server.some((b) => b.id === s.boardId);
  if (openRemoved) close();
  if (!next.length) next = [newMeta('My board')];
  await saveIndex(next);
  if (openRemoved) await open(next[0].id, next);
  notice('Signed out: your account’s boards were removed from this browser. They are safe on the server.');
}

/**
 * Move boards from this browser into your account: each is created on the server
 * (same id) and its content sent. The open one reconnects.
 */
export async function moveLocalBoards(ids: string[]) {
  const user = signedInUser();
  if (!user) {
    openAccountDialog('sign-in');
    return;
  }
  commitActiveEdit();
  await flushSave();
  const openId = useBoard.getState().boardId;
  const failed: string[] = [];
  let moved = 0;
  for (const id of ids) {
    const meta = useBoard.getState().boards.find((b) => b.id === id);
    if (!meta || meta.role) continue;
    let srv: ServerBoard;
    try {
      srv = await boardsApi.create(id, meta.name);
    } catch (err) {
      failed.push(`"${meta.name}" (${errorText(err)})`);
      continue;
    }
    if (id !== openId) {
      // Not open: send its content now. If that fails, it goes up the next time it's opened.
      const { bd } = await loadDoc(id);
      await uploadBoard(id, bd.doc);
      bd.doc.destroy();
    }
    await saveIndex(useBoard.getState().boards.map((b) => (b.id === id ? fromServer(srv, user.id) : b)));
    moved++;
  }
  if (openId && ids.includes(openId) && useBoard.getState().boards.find((b) => b.id === openId)?.role) await reopen(openId);
  if (failed.length) notice(`Could not move ${failed.join(', ')}.`, 'error');
  else if (moved) notice(`Moved ${moved} board(s) into your account.`);
}

/**
 * Open a board from a link. Boards not in this browser are asked from the server
 * (you need to be signed in and allowed on it).
 */
async function openLink(id: string) {
  const s = useBoard.getState();
  if (s.boards.some((b) => b.id === id)) return switchBoard(id);
  if (!BOARD_ID.test(id)) return;
  const a = useAccount.getState();
  if (a.status === 'loading' || a.status === 'offline' || !a.user) {
    pendingLink = id;
    if (s.boardId) setHash(s.boardId);
    if (a.status === 'signed-out') {
      notice('Sign in to open the board you were sent.');
      openAccountDialog('sign-in');
    } else if (a.status === 'offline') notice('Can’t reach the niro server to open that board.', 'error');
    return;
  }
  try {
    const srv = await boardsApi.get(id);
    await saveIndex([...useBoard.getState().boards, fromServer(srv, a.user.id)]);
    await switchBoard(id);
  } catch (err) {
    notice(errorText(err), 'error');
    const openId = useBoard.getState().boardId;
    if (openId) setHash(openId);
  }
}

// ---------- board actions ----------

/** Open another board (saves the current one first). */
export async function switchBoard(id: string) {
  const s = useBoard.getState();
  if (id === s.boardId || !s.boards.some((b) => b.id === id)) return;
  commitActiveEdit();
  await flushSave();
  await open(id, useBoard.getState().boards);
}

/** Next free "Board N" style name. */
function nextName(base: string, boards: BoardMeta[]) {
  const names = new Set(boards.map((b) => b.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A new board's entry: on the server when signed in (falls back to this browser). */
async function newBoardMeta(name: string, boards: BoardMeta[]): Promise<BoardMeta> {
  const meta = newMeta(name.trim() || nextName('Untitled board', boards));
  const user = signedInUser();
  if (!user) return meta;
  try {
    return fromServer(await boardsApi.create(meta.id, meta.name), user.id);
  } catch (err) {
    notice(`Could not create it on the server (${errorText(err)}); it is in this browser only for now.`, 'error');
    return meta;
  }
}

/** Create an empty board and open it (its document is created on opening). */
export async function createBoard(name?: string): Promise<string> {
  commitActiveEdit();
  await flushSave();
  const boards = useBoard.getState().boards;
  const meta = await newBoardMeta(name ?? '', boards);
  const next = [...useBoard.getState().boards, meta];
  await saveIndex(next);
  await open(meta.id, next);
  return meta.id;
}

export async function renameBoard(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  const meta = useBoard.getState().boards.find((b) => b.id === id);
  if (meta?.role) {
    if (meta.role === 'viewer') return notice('Only the owner and editors can rename this board.', 'error');
    try {
      await boardsApi.update(id, { name: clean });
    } catch (err) {
      return notice(errorText(err), 'error');
    }
  }
  const boards = useBoard.getState().boards.map((b) => (b.id === id ? { ...b, name: clean } : b));
  await saveIndex(boards);
}

/** Copy a board (content and camera) under a new name and open the copy (yours, on the server when signed in). */
export async function duplicateBoard(id: string) {
  commitActiveEdit();
  await flushSave();
  const boards = useBoard.getState().boards;
  const src = boards.find((b) => b.id === id);
  if (!src) return;
  const meta = await newBoardMeta(nextName(`${src.name} copy`, boards), boards);
  // A board never opened since the Yjs update only has its old save: copy whatever exists.
  for (const key of [docKey, cameraKey, boardKey]) {
    const value = await kv.get<unknown>(key(id));
    if (value !== undefined) await kv.set(key(meta.id), value);
  }
  const next = [...useBoard.getState().boards, meta];
  await saveIndex(next);
  await open(meta.id, next);
}

/**
 * Delete a board for good (the owner: also on the server), or, for a board
 * shared with you, take it out of your list. If it was open, another board
 * opens; removing the last board leaves a new empty one.
 */
export async function deleteBoard(id: string) {
  const meta = useBoard.getState().boards.find((b) => b.id === id);
  if (meta?.role) {
    try {
      await boardsApi.remove(id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) return notice(errorText(err), 'error');
    }
  }
  const s = useBoard.getState();
  const rest = s.boards.filter((b) => b.id !== id);
  if (id === s.boardId) close();
  await forget(id);
  if (!rest.length) {
    const fresh = await newBoardMeta('Untitled board', []);
    await saveIndex([fresh]);
    await open(fresh.id, [fresh]);
    return;
  }
  await saveIndex(rest);
  if (id === s.boardId) await open(rest[0].id, rest);
}

/** Import a JSON board file as a new board named after the file. */
export async function importAsNewBoard(file: File) {
  const s = useBoard.getState();
  let content;
  try {
    content = await readBoardFile(file);
  } catch (err) {
    s.showNotice(`Could not import "${file.name}": ${(err as Error).message}`, 'error');
    return;
  }
  await createBoard(file.name.replace(/\.json$/i, ''));
  // The new board's document is bound to the store, so this content is written into it.
  const st = useBoard.getState();
  st.loadBoardData(
    {
      items: Object.fromEntries(content.items.map((it) => [it.id, it])),
      order: content.items.map((it) => it.id),
      connectors: Object.fromEntries(content.connectors.map((c) => [c.id, c])),
      camera: st.camera,
    },
    st.boardId!,
    st.boards,
  );
  useBoard.getState().zoomToFit();
  s.showNotice(`Opened "${file.name}" as a new board.`);
}

/** Let the user pick a .json file and open it as a new board. */
export function pickNewBoardFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importAsNewBoard(file);
  };
  input.click();
}
