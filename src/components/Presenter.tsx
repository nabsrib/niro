import { useEffect, useMemo, useRef } from 'react';
import { useBoard } from '../store';
import { slideFrames } from '../frames';
import { fitCamera } from '../geometry';
import type { Camera } from '../types';
import { Icons } from './Icons';
import { tooltip } from '../shortcuts';

/** Screen pixels kept around a slide's frame. */
const SLIDE_PAD = 40;
const GLIDE_MS = 350;

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
  return <Presentation index={presenting.index} />;
}

function Presentation({ index }: { index: number }) {
  const items = useBoard((s) => s.items);
  const order = useBoard((s) => s.order);
  const camera = useBoard((s) => s.camera);
  const viewport = useBoard((s) => s.viewport);
  const { goToSlide, stopPresenting } = useBoard.getState();
  const slides = useMemo(() => slideFrames(items, order), [items, order]);
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

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Animate the camera to `target`. Interpolates the world point at the screen
 * center and the zoom (on a log scale), so the glide does not swing sideways.
 * Returns a function that cancels the animation.
 */
function glideTo(target: Camera, viewport: { w: number; h: number }): () => void {
  const from = useBoard.getState().camera;
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const center = (c: Camera) => ({ x: (cx - c.x) / c.z, y: (cy - c.y) / c.z });
  const a = center(from);
  const b = center(target);
  const t0 = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const t = Math.min((now - t0) / GLIDE_MS, 1);
    const k = ease(t);
    const z = Math.exp(Math.log(from.z) + (Math.log(target.z) - Math.log(from.z)) * k);
    const wx = a.x + (b.x - a.x) * k;
    const wy = a.y + (b.y - a.y) * k;
    useBoard.getState().setCamera(t < 1 ? { z, x: cx - wx * z, y: cy - wy * z } : target);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
