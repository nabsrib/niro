import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useBoard } from '../store';
import { textOn } from '../colors';
import type { ItemType } from '../types';

const PLACEHOLDER: Partial<Record<ItemType, string>> = { text: 'Type something' };

export const ItemView = memo(function ItemView({ id }: { id: string }) {
  const item = useBoard((s) => s.items[id]);
  const editing = useBoard((s) => s.editingId === id);
  const ref = useRef<HTMLDivElement>(null);
  const type = item?.type;

  // Text items size their height to their content; keep the stored h in sync
  // so selection bounds and hit-testing stay accurate.
  useLayoutEffect(() => {
    if (type !== 'text') return;
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const s = useBoard.getState();
      const cur = s.items[id];
      const h = el.offsetHeight;
      if (cur && h > 0 && Math.abs(cur.h - h) > 0.5) s.updateItems({ [id]: { h } });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, type]);

  if (!item) return null;

  const isText = item.type === 'text';
  return (
    <div
      ref={ref}
      className={`item item--${item.type}${editing ? ' item--editing' : ''}`}
      data-item-id={id}
      style={{
        transform: `translate(${item.x}px, ${item.y}px)`,
        width: item.w,
        height: isText ? undefined : item.h,
        background: isText ? 'transparent' : item.fill,
        color: isText ? item.color : textOn(item.fill),
        fontSize: item.fontSize,
      }}
    >
      {editing ? (
        <TextEditor id={id} initial={item.text} placeholder={PLACEHOLDER[item.type]} />
      ) : (
        <div className="item__text">{item.text}</div>
      )}
    </div>
  );
});

function TextEditor({ id, initial, placeholder }: { id: string; initial: string; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current!;
    el.innerText = initial;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      useBoard.getState().finishEditing(id, el.innerText.replace(/\n$/, ''));
    };
    el.addEventListener('blur', commit);
    return () => {
      el.removeEventListener('blur', commit);
      // Real unmount (not a StrictMode re-run): make sure the text is saved.
      if (!el.isConnected) commit();
    };
    // `initial` is only read on mount; later changes must not reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div
      ref={ref}
      data-editor
      data-placeholder={placeholder}
      className="item__text item__editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    />
  );
}
