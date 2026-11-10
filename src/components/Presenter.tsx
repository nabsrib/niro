import { useEffect, useMemo, useRef, useState } from 'react';
import { useBoard } from '../store';
import { presentationSlides, slideList } from '../frames';
import { fitCamera } from '../geometry';
import { glideTo } from '../cameraGlide';
import { Icons } from './Icons';
import { tooltip } from '../shortcuts';

/** Screen pixels kept around a slide's frame. */
const SLIDE_PAD = 40;

/** Top-right "Present" button: shows the frames as slides. */
export function PresentButton() {
  return (
    <button
      className="present-btn"
      data-ui
      title={tooltip('Present frames as slides', ['Alt', 'P'])}
      onClick={() => useBoard.getState().startPresenting()}
    >
      <Icons.play />
      <span>Present</span>
    </button>
  );
}

/** Presentation mode: dims everything but the current frame and shows slide controls. */
export function Presenter() {
  const presenting = useBoard((s) => s.presenting);
  if (!presenting) return null;
  return <Presentation index={presenting.index} overview={presenting.overview} />;
}

function Presentation({ index, overview }: { index: number; overview: boolean }) {
  const items = useBoard((s) => s.items);
  const order = useBoard((s) => s.order);
  const camera = useBoard((s) => s.camera);
  const viewport = useBoard((s) => s.viewport);
  const { goToSlide, stopPresenting } = useBoard.getState();
  const slides = useMemo(() => presentationSlides(items, order), [items, order]);
  const frame = slides[Math.min(index, slides.length - 1)];

  // The frames were all deleted (e.g. by undo in another tab): nothing to show.
  useEffect(() => {
    if (!frame) stopPresenting();
  }, [frame, stopPresenting]);

  // Glide the camera to the current frame; refit when the window resizes.
  const fx = frame?.x, fy = frame?.y, fw = frame?.w, fh = frame?.h;
  const { w: vw, h: vh } = viewport;
  useEffect(() => {
    if (fx === undefined || fy === undefined || fw === undefined || fh === undefined) return;
    return glideTo(fitCamera({ x: fx, y: fy, w: fw, h: fh }, vw, vh, SLIDE_PAD), { w: vw, h: vh });
  }, [fx, fy, fw, fh, vw, vh]);

  // Full screen while presenting; leaving full screen (e.g. the browser's Esc) ends it.
  const entered = useRef(false);
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) entered.current = true;
      else if (entered.current) useBoard.getState().stopPresenting();
    };
    document.addEventListener('fullscreenchange', onChange);
    document.documentElement.requestFullscreen?.().catch(() => {
      // Full screen refused (e.g. inside an iframe): present in the window instead.
    });
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  if (!frame) return null;
  const rect = {
    left: frame.x * camera.z + camera.x,
    top: frame.y * camera.z + camera.y,
    width: frame.w * camera.z,
    height: frame.h * camera.z,
  };

  return (
    <>
      <div className="present-mask" style={rect} aria-hidden="true" />
      <button
        className={`present-grid-btn${overview ? ' present-grid-btn--active' : ''}`}
        data-ui
        title="Slides: jump, reorder or hide"
        aria-label="Open slides"
        aria-pressed={overview}
        onClick={() => useBoard.getState().setOverview(!overview)}
      >
        <Icons.grid />
      </button>
      {overview && <SlidesGrid current={frame.id} />}
      <div className="present-controls" data-ui>
        <button
          className="icon-btn"
          title={tooltip('Previous slide', ['←'])}
          aria-label="Previous slide"
          disabled={index <= 0}
          onClick={() => goToSlide(index - 1)}
        >
          <Icons.chevronLeft />
        </button>
        <span className="present-count">
          {index + 1} / {slides.length}
        </span>
        <button
          className="icon-btn"
          title={tooltip('Next slide', ['→'])}
          aria-label="Next slide"
          disabled={index >= slides.length - 1}
          onClick={() => goToSlide(index + 1)}
        >
          <Icons.chevronRight />
        </button>
        <div className="divider" />
        <button className="present-exit" title={tooltip('Exit presentation', ['Esc'])} onClick={stopPresenting}>
          Exit
        </button>
      </div>
    </>
  );
}

/** Size of a w×h box scaled to fit inside maxW×maxH. */
const fit = (w: number, h: number, maxW: number, maxH: number) => {
  const k = Math.min(maxW / Math.max(w, 1), maxH / Math.max(h, 1));
  return { width: w * k, height: h * k };
};

/**
 * Slides grid shown while presenting (like Miro's slides panel): every slide as
 * a card. Click to jump, drag to reorder the presentation, eye to hide or show.
 */
function SlidesGrid({ current }: { current: string }) {
  const items = useBoard((s) => s.items);
  const order = useBoard((s) => s.order);
  const all = useMemo(() => slideList(items, order), [items, order]);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Insert the dragged card before this index. */
  const [dropAt, setDropAt] = useState<number | null>(null);
  const s = useBoard.getState();

  const jump = (id: string) => {
    const shown = presentationSlides(items, order);
    const i = shown.findIndex((f) => f.id === id);
    if (i === -1) return;
    s.goToSlide(i);
    s.setOverview(false);
  };

  const drop = () => {
    if (dragId && dropAt !== null) {
      const ids = all.map((f) => f.id);
      const from = ids.indexOf(dragId);
      if (from !== -1) {
        ids.splice(from, 1);
        ids.splice(dropAt > from ? dropAt - 1 : dropAt, 0, dragId);
        if (ids.some((id, i) => id !== all[i].id)) s.reorderSlides(ids);
      }
    }
    setDragId(null);
    setDropAt(null);
  };

  return (
    <div className="slides-grid" data-ui role="dialog" aria-label="Slides" onClick={() => s.setOverview(false)}>
      <div className="slides-grid__panel" onClick={(e) => e.stopPropagation()}>
        <div className="slides-grid__header">
          <span>Slides</span>
          <span className="slides-grid__hint">Click to jump · drag to reorder · eye to hide</span>
          <button className="icon-btn icon-btn--sm" aria-label="Close slides" onClick={() => s.setOverview(false)}>
            ×
          </button>
        </div>
        <div className="slides-grid__cards">
          {all.map((f, i) => {
            const cls = [
              'slide-card',
              f.id === current && 'slide-card--current',
              f.skipSlide && 'slide-card--hidden',
              dragId === f.id && 'slide-card--dragging',
              dropAt === i && 'slide-card--drop-before',
              dropAt === i + 1 && i === all.length - 1 && 'slide-card--drop-after',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={f.id}
                className={cls}
                draggable
                title={f.skipSlide ? 'Hidden from the presentation' : 'Click to jump here'}
                onClick={() => jump(f.id)}
                onDragStart={(e) => {
                  setDragId(f.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', f.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
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
                <div className="slide-card__thumb">
                  {/* The frame's shape and color, fitted into the card. */}
                  <span style={{ ...fit(f.w, f.h, 120, 76), background: f.fill }} />
                </div>
                <div className="slide-card__meta">
                  <span className="slide-card__num">{i + 1}</span>
                  <span className="slide-card__name">{f.text || 'Frame'}</span>
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
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
