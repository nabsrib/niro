import { useEffect, useRef, useState } from 'react';
import { exportBoard, pickBoardFile } from '../boardActions';
import { Icons } from './Icons';

/** The "niro" button in the top-left corner, with board file actions. */
export function BoardMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="board-menu" ref={ref} data-ui>
      <button
        className="brand"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        niro
        <Icons.chevronDown />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" className="menu__item" onClick={run(exportBoard)}>
            <Icons.download />
            <span>Export as JSON</span>
            <kbd>Ctrl+S</kbd>
          </button>
          <div className="menu__divider" />
          <button role="menuitem" className="menu__item" onClick={run(() => pickBoardFile('replace'))}>
            <Icons.upload />
            <span>Open JSON (replace board)…</span>
            <kbd>Ctrl+O</kbd>
          </button>
          <button role="menuitem" className="menu__item" onClick={run(() => pickBoardFile('add'))}>
            <Icons.plus />
            <span>Add JSON to board…</span>
          </button>
          <div className="menu__hint">Tip: drop a .json file on the canvas to add it there.</div>
        </div>
      )}
    </div>
  );
}
