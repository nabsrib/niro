import { useEffect } from 'react';
import { useBoard } from '../store';
import type { Tool } from '../types';
import { exportBoard, pickBoardFile } from '../boardActions';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  n: 'sticky',
  t: 'text',
  r: 'rect',
  o: 'ellipse',
  l: 'connector',
  f: 'frame',
};

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const s = useBoard.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) s.setSpaceHeld(true);
        return;
      }

      if (mod) {
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
            s.paste();
            break;
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
          s.setSelected([]);
          s.setTool('select');
          return;
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

      if (!e.shiftKey && TOOL_KEYS[key]) s.setTool(TOOL_KEYS[key]);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useBoard.getState().setSpaceHeld(false);
    };
    const onBlur = () => useBoard.getState().setSpaceHeld(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
