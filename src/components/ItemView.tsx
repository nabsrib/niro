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
import { useAssetUrl } from '../hooks/useAssetUrl';
import { domainOf } from '../links';
import {
  borderColor,
  borderDash,
  borderWidth,
  compartmentColor,
  compartmentLayout,
  isCompartmentShape,
  shapeOf,
  shapePath,
  textInset,
} from '../shapes';
import { dashArray } from '../connectors';
import { zoomToRead } from '../cameraGlide';

/** CSS border style for each border pattern. */
const CSS_DASH = { solid: 'solid', dashed: 'dashed', dotted: 'dotted' } as const;

const PLACEHOLDER: Partial<Record<ItemType, string>> = { text: 'Type something' };

/** `clip`: CSS clip-path cutting off the parts outside a clipping frame (frames.ts `clipInsets`). */
export const ItemView = memo(function ItemView({ id, clip }: { id: string; clip?: string }) {
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

  // Starting to type in something whose text is too small to read on screen: zoom in first.
  useEffect(() => {
    if (!editing) return;
    const it = useBoard.getState().items[id];
    if (!it || it.type === 'frame') return;
    const k = shapeOf(it);
    const size =
      it.type === 'rect' && isCompartmentShape(k) ? compartmentLayout(k, it.text, it.fontSize, borderWidth(it), it).fontSize : it.fontSize;
    zoomToRead(it, size);
  }, [editing, id]);

  if (!item) return null;

  if (item.type === 'path') {
    // The box itself ignores the pointer; only the stroke (plus a wider
    // invisible band) can be clicked, so big loops do not block what is inside.
    const d = smoothPath(pathPoints(item));
    return (
      <div
        className={`item item--path${item.highlight ? ' item--highlight' : ''}`}
        data-item-id={id}
        style={{ transform: `translate(${item.x}px, ${item.y}px)`, clipPath: clip, width: item.w, height: item.h }}
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
          transform: `translate(${item.x}px, ${item.y}px)`, clipPath: clip,
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

  // Comment threads are drawn as pins in screen space (Comments.tsx).
  if (item.type === 'comment') return null;

  if (item.type === 'link') {
    // Link card: the page's title (or its site while unknown), the site, and an open button.
    const site = domainOf(item.url);
    return (
      <div
        className="item item--link"
        data-item-id={id}
        style={{ transform: `translate(${item.x}px, ${item.y}px)`, clipPath: clip, width: item.w, height: item.h, fontSize: item.fontSize }}
      >
        <div className="link__body">
          <div className="link__title">{item.text || site}</div>
          <div className="link__site">{site}</div>
        </div>
        <a
          className="link__open"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          data-ui
          title={`Open ${item.url}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          ↗
        </a>
      </div>
    );
  }

  if (item.type === 'emoji') {
    // A big emoji filling its (square) box.
    return (
      <div
        className="item item--emoji"
        data-item-id={id}
        style={{
          transform: `translate(${item.x}px, ${item.y}px)`,
          clipPath: clip,
          width: item.w,
          height: item.h,
          fontSize: Math.min(item.w, item.h) * 0.8,
        }}
      >
        {item.text}
      </div>
    );
  }

  if (item.type === 'image') {
    return (
      <div
        className="item item--image"
        data-item-id={id}
        style={{ transform: `translate(${item.x}px, ${item.y}px)`, clipPath: clip, width: item.w, height: item.h }}
      >
        <AssetImage id={item.src} />
      </div>
    );
  }

  const isText = item.type === 'text';
  // Rectangles and ellipses: border color, width and pattern. Shapes other than a
  // plain rectangle are drawn as an SVG outline behind the text (shapes.ts).
  const kind = shapeOf(item);
  const bordered = item.type === 'rect' || item.type === 'ellipse';
  const svgShape = item.type === 'rect' && kind !== 'rect';
  const bw = bordered ? borderWidth(item) : 0;
  const inset = textInset(kind);
  // UML class boxes and database tables lay their text out in sections.
  const layout =
    svgShape && isCompartmentShape(kind) ? compartmentLayout(kind, item.text, item.fontSize, bw, { w: item.w, h: item.h }) : null;
  return (
    <div
      ref={ref}
      className={`item item--${item.type}${svgShape ? ' item--shape' : ''}${editing ? ' item--editing' : ''}`}
      data-item-id={id}
      style={{
        transform: `translate(${item.x}px, ${item.y}px)`, clipPath: clip,
        width: item.w,
        height: isText ? undefined : item.h,
        background: isText || svgShape ? 'transparent' : item.fill,
        ...(bordered && !svgShape
          ? { border: bw > 0 ? `${bw}px ${CSS_DASH[borderDash(item) ?? 'solid']} ${borderColor(item)}` : 'none' }
          : {}),
        ...(svgShape
          ? {
              paddingLeft: `calc(${inset.x * item.w}px + 0.6em)`,
              paddingRight: `calc(${inset.x * item.w}px + 0.6em)`,
              paddingTop: `calc(${inset.y * item.h}px + 0.3em)`,
              paddingBottom: `calc(${(inset.bottom ?? inset.y) * item.h}px + 0.3em)`,
            }
          : {}),
        color: textColor(item),
        // Class boxes and tables may shrink their text to fit (the editor uses the same size).
        fontSize: layout ? layout.fontSize : item.fontSize,
        fontWeight: item.bold ? 700 : undefined,
        fontStyle: item.italic ? 'italic' : undefined,
        textDecoration: item.underline ? 'underline' : undefined,
        textAlign: layout ? 'left' : textAlign(item),
        alignItems: isText ? undefined : layout ? 'flex-start' : FLEX_V[textVAlign(item)],
      }}
    >
      {svgShape && !layout && (
        <svg className="shape__svg" width={item.w} height={item.h} aria-hidden="true">
          <path
            d={shapePath(kind, item.w, item.h, bw / 2)}
            fill={item.fill}
            stroke={bw > 0 ? borderColor(item) : 'none'}
            strokeWidth={bw}
            strokeDasharray={dashArray(borderDash(item), bw)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {layout && (
        <svg className="shape__svg" width={item.w} height={item.h} aria-hidden="true">
          {/* A table: white body under a header band in the item's color. A class: all in its color. */}
          <rect x={bw / 2} y={bw / 2} width={Math.max(item.w - bw, 0)} height={Math.max(item.h - bw, 0)} fill={kind === 'entity' ? '#FFFFFF' : item.fill} />
          {kind === 'entity' && (
            <rect x={bw / 2} y={bw / 2} width={Math.max(item.w - bw, 0)} height={Math.max(Math.min(layout.headerH, item.h - bw) - bw / 2, 0)} fill={item.fill} />
          )}
          {layout.dividers.map((y, i) =>
            y < item.h ? <line key={i} x1={0} x2={item.w} y1={y} y2={y} stroke={borderColor(item)} strokeWidth={Math.max(bw, 1)} /> : null,
          )}
          {bw > 0 && (
            <path
              d={shapePath(kind, item.w, item.h, bw / 2)}
              fill="none"
              stroke={borderColor(item)}
              strokeWidth={bw}
              strokeDasharray={dashArray(borderDash(item), bw)}
            />
          )}
        </svg>
      )}
      {editing ? (
        <TextEditor id={id} initial={item.text} runs={itemRuns(item)} placeholder={PLACEHOLDER[item.type]} />
      ) : layout ? (
        <div className="compartments">
          {layout.lines.map((l, i) => (
            <div
              key={i}
              className="compartments__line"
              style={{
                top: l.y,
                left: layout.padX,
                right: layout.padX,
                height: layout.lineH,
                lineHeight: `${layout.lineH}px`,
                fontWeight: l.header ? 700 : undefined,
                textAlign: l.header ? 'center' : 'left',
                color: compartmentColor(item, l.header),
              }}
            >
              {l.text}
            </div>
          ))}
        </div>
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
/** An image item's picture, or a placeholder while it loads (or if it is missing). */
function AssetImage({ id }: { id?: string }) {
  const url = useAssetUrl(id);
  if (!url) return <div className="image__placeholder">{id ? 'Loading image…' : 'Missing image'}</div>;
  return <img className="image__img" src={url} alt="" draggable={false} />;
}

/** Item whose box already grew in the current edit (its growth is one undo step). */
let grownEdit: string | null = null;

/**
 * Typing more than fits in a shape (rectangles, shapes, ellipses, class boxes,
 * tables): the box grows taller, keeping its top, so nothing is hidden.
 * Miro hides the overflow instead; growing is what people ask it for.
 */
function growToFit(id: string, el: HTMLElement) {
  const s = useBoard.getState();
  const it = s.items[id];
  if (!it || it.locked || (it.type !== 'rect' && it.type !== 'ellipse')) return;
  const over = el.scrollHeight - el.clientHeight;
  if (over <= 1) return;
  // Shapes keep some of their height clear around the text (textInset), so grow by more.
  const ins = textInset(shapeOf(it));
  const share = Math.max(1 - ins.y - (ins.bottom ?? ins.y), 0.2) * (it.type === 'ellipse' ? 0.75 : 1);
  if (grownEdit !== id) {
    s.checkpoint();
    grownEdit = id;
  }
  s.updateItems({ [id]: { h: it.h + Math.ceil(over / share) + 4 } });
}

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
    grownEdit = null;
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
      onInput={() => ref.current && growToFit(id, ref.current)}
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
