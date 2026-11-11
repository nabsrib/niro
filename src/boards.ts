import { useBoard } from './store';
import { openKV, type KV } from './kv';
import { loadLegacyBoard, sanitizeBoard, type SavedBoard } from './persistence';
import { commitActiveEdit } from './editing';
import { readBoardFile } from './boardFile';
import { uid } from './geometry';
import type { BoardMeta } from './types';

/**
 * Multiple boards. Storage keys (IndexedDB, or localStorage as a fallback):
 * - `boards`: the list of boards (`BoardMeta[]`)
 * - `current`: id of the board that was open last
 * - `board:<id>`: one board's content and camera (`SavedBoard`)
 * The open board autosaves 300 ms after each change. The URL hash
 * (`#board=<id>`) keeps the same board open across reloads.
 */

let kv: KV;
const boardKey = (id: string) => `board:${id}`;
const SAVE_DELAY = 300;

const newMeta = (name: string): BoardMeta => {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now };
};

const emptyBoard = (): SavedBoard | null => null;

const hashId = () => /(?:^#|&)board=([^&]+)/.exec(window.location.hash)?.[1];
const setHash = (id: string) => {
  if (hashId() !== id) history.replaceState(null, '', `#board=${id}`);
};

async function saveIndex(boards: BoardMeta[]) {
  useBoard.getState().setBoards(boards);
  await kv.set('boards', boards);
}

/** Load a board from storage into the store and remember it as the open one. */
async function open(id: string, boards: BoardMeta[]) {
  const data = sanitizeBoard(await kv.get(boardKey(id)));
  useBoard.getState().loadBoardData(data, id, boards);
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
  let boards = (await kv.get<BoardMeta[]>('boards')) ?? [];
  if (!boards.length) {
    const meta = newMeta('My board');
    await kv.set(boardKey(meta.id), loadLegacyBoard() ?? emptyBoard());
    boards = [meta];
    await kv.set('boards', boards);
  }
  const last = await kv.get<string>('current');
  const id = [hashId(), last].find((x) => x && boards.some((b) => b.id === x)) ?? boards[0].id;
  await open(id, boards);
  startAutosave();
  // Editing the URL hash by hand (or back/forward) switches boards.
  window.addEventListener('hashchange', () => {
    const target = hashId();
    if (target && target !== useBoard.getState().boardId) void switchBoard(target);
  });
  if (kv.kind === 'localstorage') {
    useBoard
      .getState()
      .showNotice('This browser blocked the board database, so boards are kept in smaller storage.', 'error');
  }
}

// ---------- autosave ----------

let saveTimer: number | undefined;
let warnedFull = false;

/** Save the open board now. */
async function saveCurrent() {
  const s = useBoard.getState();
  const id = s.boardId;
  if (!id) return;
  const data: SavedBoard = { items: s.items, order: s.order, connectors: s.connectors, camera: s.camera };
  try {
    await kv.set(boardKey(id), data);
    warnedFull = false;
    const boards = useBoard.getState().boards.map((b) => (b.id === id ? { ...b, updatedAt: Date.now() } : b));
    await saveIndex(boards);
  } catch {
    // Unlike before, a failed save is never silent.
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
  useBoard.subscribe((s, prev) => {
    if (s.boardId !== prev.boardId) return; // a board was just loaded, nothing changed
    if (s.items === prev.items && s.order === prev.order && s.connectors === prev.connectors && s.camera === prev.camera) {
      return;
    }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      void saveCurrent();
    }, SAVE_DELAY);
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

/** Next free "Board N" style name. */
function nextName(base: string, boards: BoardMeta[]) {
  const names = new Set(boards.map((b) => b.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Create an empty board and open it. */
export async function createBoard(name?: string): Promise<string> {
  commitActiveEdit();
  await flushSave();
  const boards = useBoard.getState().boards;
  const meta = newMeta(name?.trim() || nextName('Untitled board', boards));
  await kv.set(boardKey(meta.id), emptyBoard());
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
  const data = await kv.get(boardKey(id));
  const meta = newMeta(nextName(`${src.name} copy`, boards));
  await kv.set(boardKey(meta.id), data ?? emptyBoard());
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
  if (id === s.boardId) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  await kv.del(boardKey(id));
  if (!rest.length) {
    const meta = newMeta('Untitled board');
    await kv.set(boardKey(meta.id), emptyBoard());
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
