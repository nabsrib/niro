import { useBoard } from './store';
import { clampZoom, fitCamera } from './geometry';
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

/** Text smaller than this on screen (px) is hard to type in; editing it zooms in. */
const READ_MIN_PX = 11;
/** Screen size (px) the text gets after zooming in to type. */
const READ_PX = 16;

/**
 * Starting to type in an item whose text would look tiny on screen (zoomed far
 * out): glide in until the text reads at about 16 px, centred on the item (on
 * its top part when the item is taller than the view).
 */
export function zoomToRead(box: Box, fontSize: number) {
  const { camera, viewport } = useBoard.getState();
  if (!viewport.w || fontSize <= 0 || fontSize * camera.z >= READ_MIN_PX) return;
  const z = clampZoom(READ_PX / fontSize);
  const cx = box.x + box.w / 2;
  const cy = box.h * z > viewport.h * 0.8 ? box.y + (viewport.h * 0.4) / z : box.y + box.h / 2;
  glideTo({ z, x: viewport.w / 2 - cx * z, y: viewport.h / 2 - cy * z }, viewport);
}
