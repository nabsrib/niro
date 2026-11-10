import type { Item, ItemType } from './types';
import { uid } from './geometry';

type Template = Omit<Item, 'id' | 'x' | 'y'>;

export const ITEM_DEFAULTS: Record<ItemType, Template> = {
  sticky: { type: 'sticky', w: 200, h: 200, fill: '#FFF9B1', color: '#1a1a1a', text: '', fontSize: 20 },
  rect: { type: 'rect', w: 200, h: 120, fill: '#FFFFFF', color: '#1a1a1a', text: '', fontSize: 18 },
  ellipse: { type: 'ellipse', w: 160, h: 160, fill: '#FFFFFF', color: '#1a1a1a', text: '', fontSize: 18 },
  text: { type: 'text', w: 240, h: 34, fill: 'transparent', color: '#1a1a1a', text: '', fontSize: 24 },
};

/** Create an item of `type` centered on world point (cx, cy). */
export function makeItem(type: ItemType, cx: number, cy: number): Item {
  const t = ITEM_DEFAULTS[type];
  return { ...t, id: uid(), x: cx - t.w / 2, y: cy - t.h / 2 };
}
