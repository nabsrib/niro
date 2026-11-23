import { create } from 'zustand';
import { collect, useBoard } from './store';
import { commitActiveEdit } from './editing';
import { parseBoard, type BoardContent } from './boardFile';
import { boundsOf } from './geometry';
import { glideToBox } from './cameraGlide';
import { openKV, type KV } from './kv';
import type { Item } from './types';

/**
 * Putting templates on the board, and "My templates": selections saved as
 * templates in this browser (kv key `templates`). Built-in templates are in
 * templates.ts.
 */

export interface SavedTemplate {
  id: string;
  name: string;
  createdAt: number;
  items: Item[];
  connectors: BoardContent['connectors'];
}

const KEY = 'templates';
/** Upper bound on saved templates (they live in the browser's storage). */
const MAX_SAVED = 100;

let kvPromise: Promise<KV> | null = null;
const store = () => (kvPromise ??= openKV());

/** Your saved templates, newest first (loaded when the gallery first opens). */
export const useMyTemplates = create<{ list: SavedTemplate[]; loaded: boolean }>(() => ({ list: [], loaded: false }));

/** Check saved data the same way as an imported file, so a broken entry can't break the board. */
function clean(raw: unknown): SavedTemplate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  try {
    const { items, connectors } = parseBoard(JSON.stringify({ items: r.items, connectors: r.connectors }));
    return { id: r.id, name: r.name.slice(0, 80), createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0, items, connectors };
  } catch {
    return null;
  }
}

export async function loadMyTemplates() {
  try {
    const raw = await (await store()).get<unknown[]>(KEY);
    const list = Array.isArray(raw) ? raw.map(clean).filter((t): t is SavedTemplate => !!t) : [];
    useMyTemplates.setState({ list, loaded: true });
  } catch {
    useMyTemplates.setState({ loaded: true });
  }
}

async function saveList(list: SavedTemplate[]): Promise<boolean> {
  try {
    await (await store()).set(KEY, list);
    useMyTemplates.setState({ list });
    return true;
  } catch {
    useBoard.getState().showNotice('Could not save the template: the browser storage is full or blocked.', 'error');
    return false;
  }
}

/**
 * Put template content on the board, centred on the view, as one undo step,
 * selected so it can be dragged into place. Zooms out if it doesn't fit.
 */
export function insertTemplate(content: BoardContent, name: string) {
  commitActiveEdit();
  const s = useBoard.getState();
  if (s.readOnly) return;
  if (!content.items.length && !content.connectors.length) return;
  const { camera: c, viewport: v } = s;
  const center = { x: (v.w / 2 - c.x) / c.z, y: (v.h / 2 - c.y) / c.z };
  s.setTool('select');
  s.insertBoard(content, center);
  const after = useBoard.getState();
  const box = boundsOf(after.selected.map((id) => after.items[id]).filter(Boolean));
  if (box && (box.w * c.z > v.w * 0.9 || box.h * c.z > v.h * 0.85)) glideToBox(box, 80, c.z);
  s.showNotice(`Added "${name}". Drag it into place; Ctrl+Z to undo.`);
}

/**
 * Template content from the selection (frames bring their contents). Comment
 * pins, per-person frame hiding and slide numbers are left out.
 */
export function selectionContent(): BoardContent | null {
  const s = useBoard.getState();
  const clip = collect(s, s.selected);
  const rank = new Map(s.order.map((id, i) => [id, i]));
  const items = clip.items
    .filter((it) => it.type !== 'comment')
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    .map((it) => {
      const copy: Item = { ...it };
      delete copy.hiddenBy;
      delete copy.slide;
      return copy;
    });
  const kept = new Set(items.map((it) => it.id));
  const connectors = clip.connectors.filter((c) =>
    [c.from, c.to].every((e) => e.kind === 'point' || kept.has(e.itemId)),
  );
  return items.length || connectors.length ? { items, connectors } : null;
}

/** Ask for a name and save the selection as one of your templates. */
export async function saveSelectionAsTemplate() {
  commitActiveEdit();
  const s = useBoard.getState();
  const content = selectionContent();
  if (!content) {
    s.showNotice('Select what you want to save as a template first.', 'error');
    return;
  }
  const name = window.prompt('Name for this template:', 'My template')?.trim();
  if (!name) return;
  if (!useMyTemplates.getState().loaded) await loadMyTemplates();
  const list = useMyTemplates.getState().list;
  if (list.length >= MAX_SAVED) {
    s.showNotice(`You can keep up to ${MAX_SAVED} templates. Delete one in Templates → My templates first.`, 'error');
    return;
  }
  const entry: SavedTemplate = {
    id: crypto.getRandomValues(new Uint32Array(2)).join('-'),
    name: name.slice(0, 80),
    createdAt: Date.now(),
    ...content,
  };
  if (await saveList([entry, ...list])) s.showNotice(`Saved "${entry.name}" to My templates.`);
}

export async function renameMyTemplate(id: string, name: string) {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return;
  await saveList(useMyTemplates.getState().list.map((t) => (t.id === id ? { ...t, name: trimmed } : t)));
}

export async function deleteMyTemplate(id: string) {
  await saveList(useMyTemplates.getState().list.filter((t) => t.id !== id));
}
