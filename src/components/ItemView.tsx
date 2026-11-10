import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useBoard } from '../store';
import { textOn } from '../colors';
import { pathPoints, smoothPath } from '../pen';
import { commitActiveEdit, registerActiveEdit, unregisterActiveEdit } from '../editing';
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

  if (item.type === 'path') {
    // The box itself ignores the pointer; only the stroke (plus a wider
    // invisible band) can be clicked, so big loops do not block what is inside.
    const d = smoothPath(pathPoints(item));
    return (
      <div
        className="item item--path"
        data-item-id={id}
        style={{ transform: `translate(${item.x}px, ${item.y}px)`, width: item.w, height: item.h }}
      >
        <svg width={item.w} height={item.h} className="path__svg">
          <path
            d={d}
            fill="none"
            stroke={item.color}
            strokeWidth={item.strokeWidth ?? 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d={d} className="path__hit" />
        </svg>
      </div>
    );
  }

  if (item.type === 'frame') {
    return (
      <div
        ref={ref}
        className="item item--frame"
        data-item-id={id}
        style={{
          transform: `translate(${item.x}px, ${item.y}px)`,
          width: item.w,
          height: item.h,
          background: item.fill,
        }}
      >
        <div className="frame__title" data-frame-title title={editing ? undefined : 'Drag to move, double-click to rename'}>
          {editing ? (
            <TextEditor id={id} initial={item.text} singleLine className="frame__title-editor" />
          ) : (
            item.text || 'Frame'
          )}
        </div>
      </div>
    );
  }

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

function TextEditor({
  id,
  initial,
  placeholder,
  singleLine = false,
  className = 'item__text',
}: {
  id: string;
  initial: string;
  placeholder?: string;
  /** Enter commits instead of inserting a newline. */
  singleLine?: boolean;
  className?: string;
}) {
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
      unregisterActiveEdit(commit);
      useBoard.getState().finishEditing(id, el.innerText.replace(/\n$/, ''));
    };
    registerActiveEdit(commit);
    el.addEventListener('blur', commit);
    return () => {
      el.removeEventListener('blur', commit);
      unregisterActiveEdit(commit);
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
      className={`${className} item__editor`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (singleLine || e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          commitActiveEdit();
          ref.current?.blur();
        }
      }}
    />
  );
}
