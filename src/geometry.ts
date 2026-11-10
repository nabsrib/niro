import type { Box, Camera, Vec } from './types';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
export const MIN_ITEM_SIZE = 10;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const screenToWorld = (p: Vec, c: Camera): Vec => ({
  x: (p.x - c.x) / c.z,
  y: (p.y - c.y) / c.z,
});

export const worldToScreen = (p: Vec, c: Camera): Vec => ({
  x: p.x * c.z + c.x,
  y: p.y * c.z + c.y,
});

/** Zoom to `z` while keeping the world point under `screen` fixed. */
export function zoomCameraAt(c: Camera, screen: Vec, z: number): Camera {
  const nz = clampZoom(z);
  const w = screenToWorld(screen, c);
  return { x: screen.x - w.x * nz, y: screen.y - w.y * nz, z: nz };
}

/**
 * Camera that shows `b` centered in a `w`×`h` viewport with `pad` screen pixels
 * around it, zoomed in no further than `maxZ`.
 */
export function fitCamera(b: Box, w: number, h: number, pad: number, maxZ = MAX_ZOOM): Camera {
  const z = clampZoom(Math.min((w - pad * 2) / Math.max(b.w, 1), (h - pad * 2) / Math.max(b.h, 1), maxZ));
  return { z, x: w / 2 - (b.x + b.w / 2) * z, y: h / 2 - (b.y + b.h / 2) * z };
}

export function normalizeRect(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function boundsOf(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const containsPoint = (b: Box, p: Vec) =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Handle direction: -1 = left/top edge, 1 = right/bottom edge, 0 = untouched. */
export type HandleDir = Vec;

export const HANDLES: Record<string, HandleDir> = {
  nw: { x: -1, y: -1 }, n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 },
  se: { x: 1, y: 1 }, s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 },
};

/** Resize box `b` by dragging the handle `dir` by `delta`. */
export function resizeBox(b: Box, dir: HandleDir, delta: Vec, lockAspect: boolean): Box {
  let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
  if (dir.x < 0) x1 = Math.min(x1 + delta.x, x2 - MIN_ITEM_SIZE);
  if (dir.x > 0) x2 = Math.max(x2 + delta.x, x1 + MIN_ITEM_SIZE);
  if (dir.y < 0) y1 = Math.min(y1 + delta.y, y2 - MIN_ITEM_SIZE);
  if (dir.y > 0) y2 = Math.max(y2 + delta.y, y1 + MIN_ITEM_SIZE);
  let w = x2 - x1, h = y2 - y1;

  if (lockAspect) {
    const s = dir.x && dir.y ? Math.max(w / b.w, h / b.h) : dir.x ? w / b.w : h / b.h;
    w = b.w * s;
    h = b.h * s;
    x1 = dir.x < 0 ? b.x + b.w - w : dir.x > 0 ? b.x : b.x + (b.w - w) / 2;
    y1 = dir.y < 0 ? b.y + b.h - h : dir.y > 0 ? b.y : b.y + (b.h - h) / 2;
  }
  return { x: x1, y: y1, w, h };
}

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
