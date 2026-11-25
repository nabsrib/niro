import { useEffect } from 'react';
import { useBoard } from '../store';
import type { Tool } from '../types';
import { exportBoard, pickBoardFile } from '../boardActions';
import { TOOL_SHORTCUTS } from '../shortcuts';
import { onPasteEvent, pickImageFiles, requestPaste } from '../images';
import { toggleEmojiPicker } from '../components/EmojiPicker';
import { askForLink } from '../links';
import { toggleTemplates } from '../components/TemplatesDialog';

/**
 * Start a mind map: the one selected shape becomes its central node, else a new
 * central node appears in the middle of the view (toolbar button and M).
 */
export function startMindMapHere() {
  const s = useBoard.getState();
  const sel = s.selected.length === 1 ? s.items[s.selected[0]] : undefined;
  if (sel && !sel.tree && (sel.type === 'rect' || sel.type === 'ellipse' || sel.type === 'sticky')) {
    s.startMindMap({ x: 0, y: 0 }, sel.id);
    return;
  }
  const { camera: c, viewport: v } = s;
  s.startMindMap({ x: (v.w / 2 - c.x) / c.z, y: (v.h / 2 - c.y) / c.z });
}

const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  TOOL_SHORTCUTS.map(({ key, tool }) => [key.toLowerCase(), tool] as const),
);

export const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const s = useBoard.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Presenting: only slide keys work; everything else (editing, tools) is off.
      if (s.presenting) {
        const i = s.presenting.index;
        const go: Record<string, () => void> = {
          ArrowRight: () => s.goToSlide(i + 1),
          ArrowDown: () => s.goToSlide(i + 1),
          PageDown: () => s.goToSlide(i + 1),
          ' ': () => s.goToSlide(i + 1),
          Enter: () => s.goToSlide(i + 1),
          ArrowLeft: () => s.goToSlide(i - 1),
          ArrowUp: () => s.goToSlide(i - 1),
          PageUp: () => s.goToSlide(i - 1),
          Home: () => s.goToSlide(0),
          End: () => s.goToSlide(Infinity),
          // Esc closes the slides grid first, then ends the presentation.
          Escape: () => (s.presenting?.overview ? s.setOverview(false) : s.stopPresenting()),
        };
        if (go[e.key]) {
          e.preventDefault();
          go[e.key]();
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) s.setSpaceHeld(true);
        return;
      }

      if (mod) {
        // Ctrl+Shift+L locks the selected items (or unlocks them if any is locked).
        if (e.shiftKey && key === 'l') {
          e.preventDefault();
          const sel = s.selected.map((id) => s.items[id]).filter(Boolean);
          if (sel.length) {
            const unlock = sel.some((it) => it.locked);
            s.restyleItems(
              sel.map((it) => it.id),
              () => ({ locked: unlock ? undefined : true }),
            );
          }
          return;
        }
        let handled = true;
        switch (key) {
          case 'z':
            if (e.shiftKey) s.redo();
            else s.undo();
            break;
          case 'y':
            s.redo();
            break;
          case 'a':
            s.selectAll();
            break;
          case 'd':
            s.duplicate(s.selected);
            break;
          case 'c':
            s.copy(s.selected);
            break;
          case 'x':
            s.copy(s.selected);
            s.deleteItems(s.selected);
            break;
          case 'v':
            // Let the browser's paste event through: it says whether the clipboard holds a picture.
            requestPaste();
            return;
          case 's':
            exportBoard();
            break;
          case 'o':
            pickBoardFile('replace');
            break;
          case '=':
          case '+':
            s.setZoom(s.camera.z * 1.25);
            break;
          case '-':
            s.setZoom(s.camera.z / 1.25);
            break;
          case '0':
            s.setZoom(1);
            break;
          default:
            handled = false;
        }
        if (handled) e.preventDefault();
        return;
      }
      // Alt+P presents (checked by key position so Option+P works on a Mac too).
      if (e.altKey && !e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        s.startPresenting();
        return;
      }
      if (e.altKey) return;

      if (e.shiftKey && e.code === 'Digit1') {
        s.zoomToFit();
        return;
      }

      const nudge = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          s.deleteItems(s.selected);
          return;
        case 'Escape':
          // With nothing selected, Esc leaves focus mode.
          if (!s.selected.length && s.focusId) {
            s.setFocus(null);
            return;
          }
          s.setSelected([]);
          s.setTool('select');
          return;
        case 'Tab': {
          // A selected mind map node: add a child and type in it.
          const node = s.selected.length === 1 ? s.items[s.selected[0]] : undefined;
          if (node?.tree && !s.readOnly) {
            e.preventDefault();
            s.addTreeNode(node.id, 'child');
          }
          return;
        }
        case 'Enter':
          if (s.selected.length === 1) {
            e.preventDefault();
            s.startEditing(s.selected[0]);
          }
          return;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!s.selected.length) return;
          e.preventDefault();
          const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
          const dy = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0;
          s.nudge(s.selected, dx, dy);
          return;
        }
        case ']':
          s.reorder(s.selected, 'front');
          return;
        case '[':
          s.reorder(s.selected, 'back');
          return;
      }

      // P picks the pen, Shift+P the highlighter, E the eraser (all modes of the pen tool).
      if (key === 'p' || (key === 'e' && !e.shiftKey)) {
        s.setTool('pen');
        s.setPenMode(key === 'e' ? 'eraser' : e.shiftKey ? 'highlighter' : 'pen');
        return;
      }
      // I adds an image (picks a file).
      if (key === 'i' && !e.shiftKey && !s.readOnly) {
        pickImageFiles();
        return;
      }
      // J opens the emoji picker, K adds a link card.
      if (key === 'j' && !e.shiftKey && !s.readOnly) {
        toggleEmojiPicker();
        return;
      }
      if (key === 'k' && !e.shiftKey && !s.readOnly) {
        askForLink();
        return;
      }
      // M starts a mind map: from the selected shape, or a new one in the middle of the view.
      if (key === 'm' && !e.shiftKey && !s.readOnly) {
        startMindMapHere();
        return;
      }
      // Shift+T opens the templates gallery.
      if (key === 't' && e.shiftKey && !s.readOnly) {
        toggleTemplates();
        return;
      }
      if (!e.shiftKey && TOOL_KEYS[key]) s.setTool(TOOL_KEYS[key]);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useBoard.getState().setSpaceHeld(false);
    };
    const onBlur = () => useBoard.getState().setSpaceHeld(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('paste', onPasteEvent);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('paste', onPasteEvent);
    };
  }, []);
}
