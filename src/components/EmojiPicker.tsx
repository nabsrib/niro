import { useEffect } from 'react';
import { create } from 'zustand';
import { EMOJI_GROUPS, addEmoji } from '../emoji';

/** Whether the emoji picker is open. */
export const useEmojiPicker = create<{ open: boolean }>(() => ({ open: false }));
export const toggleEmojiPicker = () => useEmojiPicker.setState((s) => ({ open: !s.open }));

/** Emoji picker next to the toolbar (button or J): click one to place it in the middle of the view. */
export function EmojiPicker() {
  const open = useEmojiPicker((s) => s.open);

  // Esc closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useEmojiPicker.setState({ open: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="frame-options emoji-picker" data-ui aria-label="Emoji">
      <div className="frame-options__title">Emoji</div>
      {EMOJI_GROUPS.map((g) => (
        <div key={g.title} className="emoji-picker__group">
          <div className="emoji-picker__label">{g.title}</div>
          <div className="emoji-picker__grid">
            {g.list.map((e) => (
              <button
                key={e}
                className="emoji-picker__btn"
                title="Place in the middle of the view"
                onClick={() => {
                  addEmoji(e);
                  useEmojiPicker.setState({ open: false });
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
