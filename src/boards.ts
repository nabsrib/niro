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
import { collabUrl, connectBoard } from './collab/connection';

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
 */

let kv: KV;
const docKey = (id: string) => `ydoc:${id}`;
const cameraKey = (id: string) => `camera:${id}`;
const boardKey = (id: string) => `board:${id}`;
const SAVE_DELAY = 300;

/** The open board: its document and how to stop syncing it with the store. */
let current: { id: string; bd: BoardDoc; stop: () => void } | null = null;

const newMeta = (name: string): BoardMeta => {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now };
};

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

/**
 * Another tab changed the boards list (new, renamed, deleted, last edited). If it
 * deleted the board open here, open another one, without saving the deleted one.
 */
function onBoardsChanged(boards: BoardMeta[]) {
  const s = useBoard.getState();
  s.setBoards(boards);
  if (!s.boardId || boards.some((b) => b.id === s.boardId) || !boards.length) return;
  close();
  void open(boards[0].id, boards).then(() =>
    useBoard.getState().showNotice('That board was deleted in another tab.', 'error'),
  );
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
    useBoard.getState().showNotice('This board was damaged in storage; it was restored from an older copy.', 'error');
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

/** Load a board from storage into the store and remember it as the open one. */
async function open(id: string, boards: BoardMeta[]) {
  close();
  const { bd, camera: oldCamera, fresh } = await loadDoc(id);
  const camera = (await kv.get<Camera>(cameraKey(id))) ?? oldCamera;
  const data = sanitizeBoard({ ...readBoard(bd), camera });
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
  const stopServer = connectBoard(id, bd);
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
  if (fromLink) boards = await addShared(fromLink, boards);
  const last = await kv.get<string>('current');
  const id = [fromLink, last].find((x) => x && boards.some((b) => b.id === x)) ?? boards[0].id;
  await open(id, boards);
  startAutosave();
  // Editing the URL hash by hand (or back/forward, or pasting a shared link) switches boards.
  window.addEventListener('hashchange', async () => {
    const target = hashId();
    if (!target || target === useBoard.getState().boardId) return;
    await addShared(target, useBoard.getState().boards);
    await switchBoard(target);
  });
  if (kv.kind === 'localstorage') {
    useBoard
      .getState()
      .showNotice('This browser blocked the board database, so boards are kept in smaller storage.', 'error');
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

// ---------- board actions ----------

/** Open another board (saves the current one first). */
export async function switchBoard(id: string) {
  const s = useBoard.getState();
  if (id === s.boardId || !s.boards.some((b) => b.id === id)) return;
  commitActiveEdit();
  await flushSave();
  await open(id, useBoard.getState().boards);
}

/**
 * A link to a board this browser doesn't have yet (shared by someone else): add it
 * to the list as "Shared board", so opening it loads the board from the server.
 * Only with a server, and only for ids that look like board ids.
 */
async function addShared(id: string, boards: BoardMeta[]): Promise<BoardMeta[]> {
  if (boards.some((b) => b.id === id) || !collabUrl() || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return boards;
  const now = Date.now();
  const next = [...boards, { id, name: nextName('Shared board', boards), createdAt: now, updatedAt: now }];
  await saveIndex(next);
  return next;
}

/** Next free "Board N" style name. */
function nextName(base: string, boards: BoardMeta[]) {
  const names = new Set(boards.map((b) => b.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Create an empty board and open it (its document is created on opening). */
export async function createBoard(name?: string): Promise<string> {
  commitActiveEdit();
  await flushSave();
  const boards = useBoard.getState().boards;
  const meta = newMeta(name?.trim() || nextName('Untitled board', boards));
  const next = [...boards, meta];
  await saveIndex(next);
  await open(meta.id, next);
  return meta.id;
}

export async function renameBoard(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  const boards = useBoard.getState().boards.map((b) => (b.id === id ? { ...b, name: clean } : b));
  await saveIndex(boards);
}

/** Copy a board (content and camera) under a new name and open the copy. */
export async function duplicateBoard(id: string) {
  commitActiveEdit();
  await flushSave();
  const boards = useBoard.getState().boards;
  const src = boards.find((b) => b.id === id);
  if (!src) return;
  const meta = newMeta(nextName(`${src.name} copy`, boards));
  // A board never opened since the Yjs update only has its old save: copy whatever exists.
  for (const key of [docKey, cameraKey, boardKey]) {
    const value = await kv.get<unknown>(key(id));
    if (value !== undefined) await kv.set(key(meta.id), value);
  }
  const next = [...boards, meta];
  await saveIndex(next);
  await open(meta.id, next);
}

/**
 * Delete a board for good. If it was open, another board opens; deleting the
 * last board leaves a new empty one.
 */
export async function deleteBoard(id: string) {
  const s = useBoard.getState();
  const rest = s.boards.filter((b) => b.id !== id);
  if (id === s.boardId) close();
  for (const key of [docKey, cameraKey, boardKey]) await kv.del(key(id));
  if (!rest.length) {
    const meta = newMeta('Untitled board');
    await saveIndex([meta]);
    await open(meta.id, [meta]);
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
