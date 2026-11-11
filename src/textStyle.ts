import type { Item, ItemType } from './types';
import { textOn } from './colors';

/**
 * Text options for stickies, shapes and text items (like Miro's text toolbar),
 * and their defaults. Pure: used by the board (ItemView) and image export.
 */

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Same font stack as the app (`:root` in styles.css). */
export const FONT_FAMILY = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Item types that hold text the user types. */
export const TEXT_TYPES: ItemType[] = ['sticky', 'rect', 'ellipse', 'text'];
export const hasText = (it: Item | undefined): it is Item => !!it && TEXT_TYPES.includes(it.type);

/** Font sizes offered in the toolbar. */
export const TEXT_SIZES = [10, 12, 14, 18, 20, 24, 32, 40, 48, 64, 80, 96, 144];
export const TEXT_COLORS = ['#1A1A1A', '#6B6B76', '#E5383B', '#F28C28', '#2BA84A', '#2F6FED', '#8E44D9', '#FFFFFF'];

/** Horizontal alignment: text items start left, stickies and shapes centered. */
export const textAlign = (it: Item): HAlign => it.align ?? (it.type === 'text' ? 'left' : 'center');
/** Vertical alignment (stickies and shapes; text items grow with their text). */
export const textVAlign = (it: Item): VAlign => it.valign ?? 'middle';
/** Text color: text items use `color`; stickies and shapes a chosen color or one readable on the fill. */
export const textColor = (it: Item): string => (it.type === 'text' ? it.color : (it.textColor ?? textOn(it.fill)));
/** CSS font shorthand for measuring text in this item's style. */
export const fontCss = (it: Pick<Item, 'bold' | 'italic'>, size: number): string =>
  `${it.italic ? 'italic ' : ''}${it.bold ? 700 : 400} ${size}px ${FONT_FAMILY}`;

/** Flexbox value for a vertical alignment. */
export const FLEX_V: Record<VAlign, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
