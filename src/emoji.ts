import { useBoard } from './store';
import { ITEM_DEFAULTS } from './defaults';
import { screenToWorld, uid } from './geometry';

/** Emoji offered in the picker, grouped like Miro's reactions and stickers. */
export const EMOJI_GROUPS: { title: string; list: string[] }[] = [
  { title: 'Reactions', list: ['👍', '👎', '❤️', '🎉', '😀', '😂', '😮', '😢', '🤔', '👏', '🙌', '🔥'] },
  { title: 'Status', list: ['✅', '❌', '⚠️', '❓', '❗', '⭐', '🚧', '🚀', '💡', '🎯', '📌', '🔒'] },
  { title: 'Things', list: ['📅', '⏰', '📈', '📉', '💬', '📝', '📎', '🔗', '💰', '🏁', '🧩', '🛠️'] },
  { title: 'Arrows', list: ['⬆️', '⬇️', '⬅️', '➡️', '↗️', '↘️', '🔄', '🔁', '1️⃣', '2️⃣', '3️⃣', '4️⃣'] },
];

/** Place an emoji in the middle of the view (one undo step) and select it. */
export function addEmoji(char: string) {
  const s = useBoard.getState();
  if (s.readOnly) return s.showNotice('This board is view only.');
  const { camera, viewport } = s;
  const c = screenToWorld({ x: viewport.w / 2, y: viewport.h / 2 }, camera);
  // About 96 px on screen at any zoom.
  const size = ITEM_DEFAULTS.emoji.w / camera.z;
  const item = { ...ITEM_DEFAULTS.emoji, id: uid(), x: c.x - size / 2, y: c.y - size / 2, w: size, h: size, text: char };
  s.checkpoint();
  useBoard.setState((cur) => ({
    items: { ...cur.items, [item.id]: item },
    order: [...cur.order, item.id],
    selected: [item.id],
    tool: 'select',
    editingId: null,
  }));
}
