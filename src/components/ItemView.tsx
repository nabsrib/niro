import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useBoard } from '../store';
import { FLEX_V, textAlign, textColor, textVAlign } from '../textStyle';
import { pathPoints, smoothPath } from '../pen';
import {
  commitActiveEdit,
  registerActiveEdit,
  registerRichEdit,
  unregisterActiveEdit,
  unregisterRichEdit,
  type RichEditApi,
} from '../editing';
import { clearStyles, domToRuns, runsToDom, styleAt, styleRange } from '../richEditor';
import { itemRuns, normalizeRuns, runCss } from '../richText';
import type { ItemType, RunStyle, TextRun } from '../types';

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
        className={`item item--path${item.highlight ? ' item--highlight' : ''}`}
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
        className={`item item--frame${item.deck ? ' item--deck' : ''}`}
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
        color: textColor(item),
        fontSize: item.fontSize,
        fontWeight: item.bold ? 700 : undefined,
        fontStyle: item.italic ? 'italic' : undefined,
        textDecoration: item.underline ? 'underline' : undefined,
        textAlign: textAlign(item),
        alignItems: isText ? undefined : FLEX_V[textVAlign(item)],
      }}
    >
      {editing ? (
        <TextEditor id={id} initial={item.text} runs={itemRuns(item)} placeholder={PLACEHOLDER[item.type]} />
      ) : (
        <div className="item__text">
          {item.rich
            ? item.rich.map((r, i) => (
                <span key={i} style={runCss(r)}>
                  {r.text}
                </span>
              ))
            : item.text}
        </div>
      )}
    </div>
  );
});

/**
 * Inline text editor; saves through `finishEditing` on blur, Esc or Ctrl+Enter.
 * With `runs` it edits rich text (stickies, shapes, text items): the toolbar
 * can style the selected part while typing. Without, it is plain text
 * (connector labels, frame titles).
 */
export function TextEditor({
  id,
  initial,
  runs,
  placeholder,
  singleLine = false,
  className = 'item__text',
}: {
  id: string;
  initial: string;
  /** Rich text to edit; omit for a plain-text editor. */
  runs?: TextRun[];
  placeholder?: string;
  /** Enter commits instead of inserting a newline. */
  singleLine?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rich = !!runs;

  useEffect(() => {
    const el = ref.current!;
    if (runs) runsToDom(el, runs);
    else el.innerText = initial;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Remember the selection inside the editor: the toolbar's size menu takes
    // focus, and styling must still apply to what was selected.
    let saved: Range | null = range.cloneRange();
    const onSelection = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && el.contains(s.getRangeAt(0).commonAncestorContainer)) saved = s.getRangeAt(0).cloneRange();
    };
    const select = (r: Range) => {
      el.focus();
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
      saved = r.cloneRange();
    };
    const api: RichEditApi = {
      id,
      apply: (patch) => {
        const r = saved;
        const keys = (Object.keys(patch) as (keyof RunStyle)[]).filter((k) => patch[k] !== undefined);
        if (!r || r.collapsed || !el.contains(r.commonAncestorContainer)) {
          clearStyles(el, keys);
          if (r) select(r);
          return false;
        }
        select(styleRange(r, patch));
        return true;
      },
      current: () => styleAt(el, saved?.startContainer ?? null),
    };

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      unregisterActiveEdit(commit);
      if (runs) {
        const { text, runs: next } = domToRuns(el);
        useBoard.getState().finishEditing(id, text, normalizeRuns(next) ?? null);
      } else {
        useBoard.getState().finishEditing(id, el.innerText.replace(/\n$/, ''));
      }
    };
    // Focus moving to the text toolbar (e.g. its size menu) keeps the editor open.
    const onBlur = (e: FocusEvent) => {
      if ((e.relatedTarget as Element | null)?.closest?.('[data-text-toolbar]')) return;
      commit();
    };
    registerActiveEdit(commit);
    if (runs) {
      registerRichEdit(api);
      document.addEventListener('selectionchange', onSelection);
    }
    el.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('blur', onBlur);
      document.removeEventListener('selectionchange', onSelection);
      unregisterRichEdit(api);
      unregisterActiveEdit(commit);
      // Real unmount (not a StrictMode re-run): make sure the text is saved.
      if (!el.isConnected) commit();
    };
    // `initial` / `runs` are only read on mount; later changes must not reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div
      ref={ref}
      data-editor
      data-placeholder={placeholder}
      className={`${className} item__editor`}
      contentEditable={rich ? 'true' : 'plaintext-only'}
      suppressContentEditableWarning
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (singleLine || e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          commitActiveEdit();
          ref.current?.blur();
          return;
        }
        // Rich editor: Enter adds a line break (not a new <div>).
        if (rich && e.key === 'Enter') {
          e.preventDefault();
          document.execCommand('insertLineBreak');
        }
      }}
      onPaste={(e) => {
        if (!rich) return;
        // Paste as plain text, in the style at the caret.
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
    />
  );
}
