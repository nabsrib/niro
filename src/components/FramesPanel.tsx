import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useBoard } from '../store';
import { slideList } from '../frames';
import { collectExport, contentToSvg } from '../exportImage';
import { measureText } from '../exportActions';
import { glideToBox } from '../cameraGlide';
import { Icons } from './Icons';
import type { Item } from '../types';
import { useMyIdentity } from '../identity';

/** Whether the frames panel is open. */
export const useFramesPanel = create<{ open: boolean }>(() => ({ open: false }));
export const toggleFramesPanel = () => useFramesPanel.setState((s) => ({ open: !s.open }));

const THUMB_W = 176;
const THUMB_H = 100;
/** Wait this long after the last change before redrawing thumbnails. */
const THUMB_DELAY = 600;

/** A frame's contents as a small SVG picture (data URL), drawn from board data like an export. */
function thumbnail(frame: Item): string | null {
  const s = useBoard.getState();
  const k = Math.min(THUMB_W / frame.w, THUMB_H / frame.h);
  const content = collectExport({ kind: 'frame', frameId: frame.id }, s.items, s.order, s.connectors, [], k);
  if (!content) return null;
  // Text as lines (no HTML inside an <img>); pictures of image items show as grey boxes.
  const svg = contentToSvg(content, s.items, { textMode: 'lines', measure: measureText, background: null, pxPerUnit: k });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Frames panel (like Miro's): every frame in presentation order with a live
 * thumbnail. Click to go to a frame, double-click its name to rename it, drag
 * to reorder the presentation, eye to hide it from the presentation.
 */
export function FramesPanel() {
  const open = useFramesPanel((s) => s.open);
  const items = useBoard((s) => s.items);
  const order = useBoard((s) => s.order);
  const readOnly = useBoard((s) => s.readOnly);
  const me = useMyIdentity();
  const frames = useMemo(() => slideList(items, order), [items, order]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const s = useBoard.getState();

  // Redraw thumbnails a moment after the board stops changing (only while open).
  useEffect(() => {
    if (!open) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const next: Record<string, string | null> = {};
      for (const f of slideList(useBoard.getState().items, useBoard.getState().order)) next[f.id] = thumbnail(f);
      setThumbs(next);
    }, THUMB_DELAY);
    return () => window.clearTimeout(timer.current);
  }, [open, items, order]);

  if (!open) return null;
  const close = () => useFramesPanel.setState({ open: false });

  const goTo = (f: Item) => {
    s.setSelected([f.id]);
    glideToBox(f, 60);
  };

  const drop = () => {
    if (dragId && dropAt !== null) {
      const ids = frames.map((f) => f.id);
      const from = ids.indexOf(dragId);
      if (from !== -1) {
        ids.splice(from, 1);
        ids.splice(dropAt > from ? dropAt - 1 : dropAt, 0, dragId);
        if (ids.some((id, i) => id !== frames[i].id)) s.reorderSlides(ids);
      }
    }
    setDragId(null);
    setDropAt(null);
  };

  const rename = (id: string, text: string) => {
    setRenaming(null);
    const clean = text.trim();
    if (!clean || clean === useBoard.getState().items[id]?.text) return;
    s.checkpoint();
    s.updateItems({ [id]: { text: clean } });
  };

  return (
    <aside className="frames-panel" data-ui aria-label="Frames">
      <div className="frames-panel__header">
        <span>Frames</span>
        <span className="frames-panel__count">{frames.length}</span>
        <button className="icon-btn icon-btn--sm" aria-label="Close frames" onClick={close}>
          ×
        </button>
      </div>
      {!frames.length && <p className="frames-panel__empty">No frames yet. Press F and click the board to add one.</p>}
      <div className="frames-panel__list">
        {frames.map((f, i) => (
          <div
            key={f.id}
            className={[
              'frame-card',
              f.skipSlide && 'frame-card--hidden',
              dragId === f.id && 'frame-card--dragging',
              dropAt === i && 'frame-card--drop-before',
              dropAt === i + 1 && i === frames.length - 1 && 'frame-card--drop-after',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable={!readOnly && renaming !== f.id}
            title="Click to go there · drag to reorder"
            onClick={() => goTo(f)}
            onDragStart={(e) => {
              setDragId(f.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', f.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop();
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropAt(null);
            }}
          >
            <div className="frame-card__thumb">
              {f.hiddenBy && f.hiddenBy !== me ? (
                <em className="frame-card__hidden">Hidden</em>
              ) : thumbs[f.id] ? (
                <img src={thumbs[f.id]!} alt="" draggable={false} />
              ) : (
                <span style={{ background: f.fill }} />
              )}
            </div>
            <div className="frame-card__meta">
              <span className="frame-card__num">{i + 1}</span>
              {renaming === f.id ? (
                <input
                  className="frame-card__rename"
                  defaultValue={f.text}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') rename(f.id, e.currentTarget.value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => rename(f.id, e.currentTarget.value)}
                />
              ) : (
                <span
                  className="frame-card__name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!readOnly) setRenaming(f.id);
                  }}
                >
                  {f.text || 'Frame'}
                </span>
              )}
              {!readOnly && (
                <button
                  className="icon-btn icon-btn--sm"
                  title={f.skipSlide ? 'Show in presentation' : 'Hide from presentation'}
                  aria-label={f.skipSlide ? 'Show in presentation' : 'Hide from presentation'}
                  onClick={(e) => {
                    e.stopPropagation();
                    s.setSkipSlide(f.id, !f.skipSlide);
                  }}
                >
                  {f.skipSlide ? <Icons.eyeOff /> : <Icons.eye />}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
