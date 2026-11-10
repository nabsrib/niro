import type { Box, Item } from './types';

type ItemMap = Record<string, Item | undefined>;

export const isFrame = (it: Item | undefined): it is Item => it?.type === 'frame';

const centerInside = (it: Box, f: Box) => {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
};

/**
 * Items that belong to any of `frameIds`. Membership is geometric: an item is
 * in a frame while its center is inside the frame. Frames do not nest.
 */
export function frameChildren(frameIds: string[], items: ItemMap, order: string[]): string[] {
  const frames = frameIds.map((id) => items[id]).filter(isFrame);
  if (!frames.length) return [];
  return order.filter((id) => {
    const it = items[id];
    return !!it && !isFrame(it) && frames.some((f) => centerInside(it, f));
  });
}

/** `ids` plus the contents of any frames among them (no duplicates). */
export function withFrameChildren(ids: string[], items: ItemMap, order: string[]): string[] {
  const kids = frameChildren(ids, items, order);
  return kids.length ? Array.from(new Set([...ids, ...kids])) : ids;
}

/** Frames always draw behind everything else, keeping their relative order. */
export function renderOrder(order: string[], items: ItemMap): string[] {
  const frames = order.filter((id) => isFrame(items[id]));
  if (!frames.length) return order;
  return [...frames, ...order.filter((id) => !isFrame(items[id]))];
}
