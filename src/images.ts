import { useBoard } from './store';
import { ITEM_DEFAULTS } from './defaults';
import { screenToWorld, uid } from './geometry';
import type { Item, Vec } from './types';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, ensureOnServer, newAssetId, saveAsset } from './assets';
import { addLinkCard, normalizeUrl } from './links';

/**
 * Adding images to the board: paste (Ctrl+V), drop files on the canvas, or the
 * Image button (I). Each picture becomes an image item sized to fit the view;
 * its file is kept in this browser and, on a board kept with an account, sent
 * to the server so everyone sees it (assets.ts).
 */

/** Largest share of the view a new image takes. */
const FIT = 0.6;

const notice = (text: string, kind: 'info' | 'error' = 'info') => useBoard.getState().showNotice(text, kind);

/** Pixel size of a picture file. */
async function imageSize(file: Blob): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Whether the open board is kept with an account (its pictures go to the server). */
export function openBoardOnServer(): boolean {
  const s = useBoard.getState();
  return !!s.boards.find((b) => b.id === s.boardId)?.role;
}

/**
 * Add picture files as image items centered on world point `at` (default: the
 * middle of the view), one undo step, and select them.
 */
export async function addImageFiles(files: File[], at?: Vec): Promise<void> {
  const s = useBoard.getState();
  if (s.readOnly) return notice('This board is view only.');
  const pictures = files.filter((f) => IMAGE_TYPES.includes(f.type));
  if (!pictures.length) {
    if (files.some((f) => f.type.startsWith('image/'))) notice('Only PNG, JPEG, GIF and WebP images can be added.', 'error');
    return;
  }
  const { camera, viewport } = s;
  const center = at ?? screenToWorld({ x: viewport.w / 2, y: viewport.h / 2 }, camera);
  const maxW = (viewport.w * FIT) / camera.z;
  const maxH = (viewport.h * FIT) / camera.z;
  const made: Item[] = [];
  for (const file of pictures) {
    if (file.size > MAX_IMAGE_BYTES) {
      notice(`"${file.name}" is too large (over 10 MB).`, 'error');
      continue;
    }
    let size: { w: number; h: number };
    try {
      size = await imageSize(file);
    } catch {
      notice(`Could not read "${file.name}" as an image.`, 'error');
      continue;
    }
    const k = Math.min(1, maxW / size.w, maxH / size.h);
    const w = Math.max(size.w * k, 10);
    const h = Math.max(size.h * k, 10);
    const id = newAssetId();
    await saveAsset(id, file);
    // Several pictures at once: each a little further down-right.
    const shift = (made.length * 24) / camera.z;
    made.push({ ...ITEM_DEFAULTS.image, id: uid(), x: center.x - w / 2 + shift, y: center.y - h / 2 + shift, w, h, src: id });
  }
  if (!made.length) return;
  const st = useBoard.getState();
  st.checkpoint();
  useBoard.setState((cur) => ({
    items: { ...cur.items, ...Object.fromEntries(made.map((it) => [it.id, it])) },
    order: [...cur.order, ...made.map((it) => it.id)],
    selected: made.map((it) => it.id),
    tool: 'select',
    editingId: null,
  }));
  if (openBoardOnServer()) {
    const ok = await ensureOnServer(made.map((it) => it.src!));
    if (!ok) notice('Could not upload the image yet; it shows here and is sent when the server is reachable.', 'error');
  }
}

/** Let the user pick picture files and add them in the middle of the view. */
export function pickImageFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMAGE_TYPES.join(',');
  input.multiple = true;
  input.onchange = () => {
    if (input.files?.length) void addImageFiles([...input.files]);
  };
  input.click();
}

// ---------- paste ----------

/**
 * Ctrl+V: the browser's paste event says whether the clipboard holds a picture.
 * The shortcut only asks for a paste; if no paste event follows (some browsers
 * don't send one), board items copied in niro are pasted as before.
 */
let pasteTimer: number | undefined;

export function requestPaste() {
  window.clearTimeout(pasteTimer);
  pasteTimer = window.setTimeout(() => {
    pasteTimer = undefined;
    useBoard.getState().paste();
  }, 80);
}

export function onPasteEvent(e: ClipboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (useBoard.getState().presenting) return;
  const asked = pasteTimer !== undefined;
  window.clearTimeout(pasteTimer);
  pasteTimer = undefined;
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  // A copied web address (starting with http:// or https://) becomes a link card.
  const pasted = (e.clipboardData?.getData('text/plain') ?? '').trim();
  const link = files.length || !/^https?:\/\//i.test(pasted) ? null : normalizeUrl(pasted);
  if (files.length) {
    e.preventDefault();
    void addImageFiles(files);
  } else if (link) {
    e.preventDefault();
    void addLinkCard(link);
  } else if (asked) {
    useBoard.getState().paste();
  }
}
