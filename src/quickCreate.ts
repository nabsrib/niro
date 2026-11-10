import type { Box, Item, Side } from './types';
import { intersects } from './geometry';

/** World-unit gap between an item and the copy created next to it. */
export const QUICK_GAP = 100;

export const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/**
 * Items that get "click the dot to add a connected copy". Text is excluded
 * because an empty text item deletes itself, and frames have no dots.
 */
export const canQuickCreate = (it: Item | undefined): it is Item =>
  !!it && it.type !== 'text' && it.type !== 'frame';

/**
 * Where a same-size copy of `src` goes when created from its `side` dot:
 * one gap away on that side, or slid sideways (alternating directions) to the
 * nearest spot that does not overlap another item.
 */
export function quickCreateBox(
  src: Item,
  side: Side,
  items: Record<string, Item | undefined>,
  order: string[],
): Box {
  const base: Box = {
    w: src.w,
    h: src.h,
    x:
      side === 'left'
        ? src.x - QUICK_GAP - src.w
        : side === 'right'
          ? src.x + src.w + QUICK_GAP
          : src.x,
    y:
      side === 'top'
        ? src.y - QUICK_GAP - src.h
        : side === 'bottom'
          ? src.y + src.h + QUICK_GAP
          : src.y,
  };
  const horizontal = side === 'left' || side === 'right';
  const step = (horizontal ? src.h : src.w) + QUICK_GAP / 2;
  const others = order
    .map((id) => items[id])
    .filter((it): it is Item => !!it && it.id !== src.id && it.type !== 'frame');
  const pad = 10;
  const free = (b: Box) =>
    !others.some((o) => intersects({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, o));

  // Try 0, +1, -1, +2, -2, ... steps along the side.
  for (let i = 0; i < 13; i++) {
    const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    const b = horizontal ? { ...base, y: base.y + k * step } : { ...base, x: base.x + k * step };
    if (free(b)) return b;
  }
  return base;
}
