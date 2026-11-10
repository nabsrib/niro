import { useBoard } from './store';
import { fitCamera } from './geometry';
import type { Box, Camera } from './types';

const GLIDE_MS = 350;

/** Cancels the glide in progress; a new glide replaces it instead of fighting it. */
let cancelActive: (() => void) | null = null;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Animate the store camera to `target`. Interpolates the world point at the
 * screen center and the zoom (on a log scale), so the glide does not swing
 * sideways. Returns a function that cancels the animation.
 */
export function glideTo(target: Camera, viewport: { w: number; h: number }, ms = GLIDE_MS): () => void {
  cancelActive?.();
  const from = useBoard.getState().camera;
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const center = (c: Camera) => ({ x: (cx - c.x) / c.z, y: (cy - c.y) / c.z });
  const a = center(from);
  const b = center(target);
  const t0 = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const t = Math.min((now - t0) / ms, 1);
    const k = ease(t);
    const z = Math.exp(Math.log(from.z) + (Math.log(target.z) - Math.log(from.z)) * k);
    const wx = a.x + (b.x - a.x) * k;
    const wy = a.y + (b.y - a.y) * k;
    useBoard.getState().setCamera(t < 1 ? { z, x: cx - wx * z, y: cy - wy * z } : target);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  const cancel = () => {
    cancelAnimationFrame(raf);
    if (cancelActive === cancel) cancelActive = null;
  };
  cancelActive = cancel;
  return cancel;
}

/** Glide so `box` fills the current viewport, with `pad` screen pixels around it. */
export function glideToBox(box: Box, pad = 80, maxZ = 2): () => void {
  const { viewport } = useBoard.getState();
  return glideTo(fitCamera(box, viewport.w, viewport.h, pad, maxZ), viewport);
}
