import type { Tool } from './types';

/**
 * Keyboard and mouse shortcuts shown in the shortcuts panel and in button
 * tooltips. One combo is a list of keys pressed together; `Mod` is Ctrl, or
 * Cmd on a Mac. Keep this list in sync with `useKeyboardShortcuts` and the
 * README.
 */
export type Combo = string[];

export interface Shortcut {
  label: string;
  /** Alternative combos that do the same thing. */
  combos: Combo[];
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** Single-key tool shortcuts. The toolbar and the keyboard handler both use this. */
export const TOOL_SHORTCUTS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'hand', label: 'Hand', key: 'H' },
  { tool: 'sticky', label: 'Sticky note', key: 'N' },
  { tool: 'text', label: 'Text', key: 'T' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'connector', label: 'Connector', key: 'L' },
  { tool: 'pen', label: 'Pen', key: 'P' },
  { tool: 'frame', label: 'Frame', key: 'F' },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    items: [
      ...TOOL_SHORTCUTS.map(({ label, key }) => ({ label, combos: [[key]] })),
      { label: 'Highlighter', combos: [['Shift', 'P']] },
      { label: 'Eraser', combos: [['E']] },
    ],
  },
  {
    title: 'Edit',
    items: [
      { label: 'Undo', combos: [['Mod', 'Z']] },
      { label: 'Redo', combos: [['Mod', 'Shift', 'Z'], ['Mod', 'Y']] },
      { label: 'Duplicate', combos: [['Mod', 'D']] },
      { label: 'Copy', combos: [['Mod', 'C']] },
      { label: 'Cut', combos: [['Mod', 'X']] },
      { label: 'Paste', combos: [['Mod', 'V']] },
      { label: 'Delete', combos: [['Del'], ['Backspace']] },
      { label: 'Select all', combos: [['Mod', 'A']] },
      { label: 'Deselect', combos: [['Esc']] },
      { label: 'Edit text or connector label', combos: [['Enter'], ['Double-click']] },
      { label: 'Finish editing', combos: [['Esc'], ['Mod', 'Enter']] },
    ],
  },
  {
    title: 'Arrange',
    items: [
      { label: 'Nudge 1px', combos: [['Arrows']] },
      { label: 'Nudge 10px', combos: [['Shift', 'Arrows']] },
      { label: 'Bring to front', combos: [[']']] },
      { label: 'Send to back', combos: [['[']] },
      { label: 'Move without snapping', combos: [['Alt', 'Drag']] },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Pan', combos: [['Scroll'], ['Right-drag'], ['Space', 'Drag']] },
      { label: 'Zoom', combos: [['Mod', 'Scroll']] },
      { label: 'Zoom in', combos: [['Mod', '=']] },
      { label: 'Zoom out', combos: [['Mod', '-']] },
      { label: 'Zoom to 100%', combos: [['Mod', '0']] },
      { label: 'Zoom to fit', combos: [['Shift', '1']] },
    ],
  },
  {
    title: 'Board',
    items: [
      { label: 'Export JSON', combos: [['Mod', 'S']] },
      { label: 'Open JSON (replace board)', combos: [['Mod', 'O']] },
      { label: 'Present frames as slides', combos: [['Alt', 'P']] },
      { label: 'Leave focus mode (nothing selected)', combos: [['Esc']] },
      { label: 'Show shortcuts', combos: [['?']] },
    ],
  },
  {
    title: 'Presenting',
    items: [
      { label: 'Next slide', combos: [['→'], ['Space']] },
      { label: 'Previous slide', combos: [['←']] },
      { label: 'First / last slide', combos: [['Home'], ['End']] },
      { label: 'Exit', combos: [['Esc']] },
    ],
  },
];

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Display name of one key for this platform. */
export function keyName(key: string): string {
  if (!IS_MAC) return key === 'Mod' ? 'Ctrl' : key;
  switch (key) {
    case 'Mod':
      return '⌘';
    case 'Alt':
      return '⌥';
    case 'Shift':
      return '⇧';
    default:
      return key;
  }
}

/** Combo as plain text for tooltips, e.g. "Ctrl+Shift+Z". */
export function comboText(combo: Combo): string {
  return combo.map(keyName).join(IS_MAC ? '' : '+');
}

/** Button tooltip: label plus its shortcut, e.g. "Undo  Ctrl+Z". */
export function tooltip(label: string, combo: Combo): string {
  return `${label}  ${comboText(combo)}`;
}
