import { useBoard } from './store';
import { ITEM_DEFAULTS } from './defaults';
import { screenToWorld, uid } from './geometry';
import type { Vec } from './types';

/**
 * Link cards: a web address shown as a card with the page's title and its site.
 * Add one by pasting an address (Ctrl+V) or with the Link button (K). The title
 * comes from the niro server (`/api/link-preview`, server/links.mjs), which reads
 * the page for us (browsers can't read other sites); without the server the card
 * shows the site name, and the title can be typed in from the card's toolbar.
 */

/** A pasted or typed address as a clean http(s) URL, or null. "example.com" becomes https://example.com. */
export function normalizeUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text || /\s/.test(text) || text.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    if (!/^[^/]+\.[a-z]{2,}(\/|$)/i.test(text)) return null;
    text = `https://${text}`;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The site of an address, without "www.". */
export function domainOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Ask the niro server for the page's title (null if it can't tell). */
async function fetchTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string | null };
    return typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** Add a link card centered on `at` (default: the middle of the view), one undo step; its title fills in when known. */
export async function addLinkCard(url: string, at?: Vec): Promise<void> {
  const s = useBoard.getState();
  if (s.readOnly) return s.showNotice('This board is view only.');
  const { camera, viewport } = s;
  const c = at ?? screenToWorld({ x: viewport.w / 2, y: viewport.h / 2 }, camera);
  const d = ITEM_DEFAULTS.link;
  // The same size on screen at any zoom.
  const k = 1 / camera.z;
  const item = { ...d, id: uid(), x: c.x - (d.w * k) / 2, y: c.y - (d.h * k) / 2, w: d.w * k, h: d.h * k, fontSize: d.fontSize * k, url, text: '' };
  s.checkpoint();
  useBoard.setState((cur) => ({
    items: { ...cur.items, [item.id]: item },
    order: [...cur.order, item.id],
    selected: [item.id],
    tool: 'select',
    editingId: null,
  }));
  const title = await fetchTitle(url);
  // Part of the same undo step: removing the card removes its title too.
  if (title && useBoard.getState().items[item.id] && !useBoard.getState().items[item.id].text) {
    useBoard.getState().updateItems({ [item.id]: { text: title } });
  }
}

/** Link button / K: ask for an address and add its card. */
export function askForLink() {
  const raw = window.prompt('Web address for the link card:');
  if (raw === null) return;
  const url = normalizeUrl(raw);
  if (!url) return useBoard.getState().showNotice('That doesn’t look like a web address (http or https).', 'error');
  void addLinkCard(url);
}

/** Open a link card's address in a new tab. */
export function openLink(url: string | undefined) {
  if (url && normalizeUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}
