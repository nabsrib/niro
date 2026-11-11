import { useEffect, useRef, useState } from 'react';
import { exportBoard, pickBoardFile } from '../boardActions';
import { createBoard, deleteBoard, duplicateBoard, pickNewBoardFile, renameBoard, switchBoard } from '../boards';
import { Icons } from './Icons';
import { useBoard } from '../store';
import { comboText } from '../shortcuts';
import type { BoardMeta } from '../types';

/**
 * The "Niro / board name" button in the top-left corner: the boards list
 * (switch, new, rename, duplicate, delete) and board file actions.
 */
export function BoardMenu() {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const boards = useBoard((s) => s.boards);
  const boardId = useBoard((s) => s.boardId);
  const current = boards.find((b) => b.id === boardId);

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

  useEffect(() => {
    if (!open) setRenaming(null);
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const remove = (b: BoardMeta) => {
    const msg =
      `Delete "${b.name}"?\n\nThis removes the board for good and cannot be undone. ` +
      'Export it as JSON first if you want to keep a copy.';
    if (window.confirm(msg)) void deleteBoard(b.id);
  };

  // Newest first, but the open board always on top.
  const sorted = [...boards].sort((a, b) => (a.id === boardId ? -1 : b.id === boardId ? 1 : b.updatedAt - a.updatedAt));

  return (
    <div className="board-menu" ref={ref} data-ui>
      {/* Top-left bar, like Miro's: logo + name + board (opens the menu), then quick actions. */}
      <div className="board-bar">
        <button
          className="brand"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Boards and board menu"
          onClick={() => setOpen((o) => !o)}
        >
          <img className="brand__mark" src="/logo-mark.png" alt="" width={30} height={30} draggable={false} />
          <span className="brand__name">Niro</span>
          {current && (
            <>
              <span className="brand__divider" aria-hidden="true" />
              <span className="brand__board">{current.name}</span>
            </>
          )}
          <Icons.chevronDown />
        </button>
        <span className="board-bar__divider" aria-hidden="true" />
        <button
          className="icon-btn"
          title="Export image (PNG / SVG)"
          aria-label="Export image"
          onClick={() => useBoard.getState().openExport()}
        >
          <Icons.image />
        </button>
      </div>
      {open && (
        <div className="menu" role="menu">
          <div className="menu__section">Boards</div>
          <div className="board-list">
            {sorted.map((b) => (
              <div key={b.id} className={`board-row${b.id === boardId ? ' board-row--current' : ''}`}>
                {renaming === b.id ? (
                  <RenameField
                    initial={b.name}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name) void renameBoard(b.id, name);
                    }}
                  />
                ) : (
                  <button
                    role="menuitemradio"
                    aria-checked={b.id === boardId}
                    className="board-row__open"
                    title={b.id === boardId ? 'Open now · double-click to rename' : 'Open this board'}
                    onClick={run(() => void switchBoard(b.id))}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setOpen(true);
                      setRenaming(b.id);
                    }}
                  >
                    <span className="board-row__check">{b.id === boardId && <Icons.check />}</span>
                    <span className="board-row__name">{b.name}</span>
                  </button>
                )}
                <span className="board-row__actions">
                  <button className="icon-btn icon-btn--sm" title="Rename" aria-label={`Rename ${b.name}`} onClick={() => setRenaming(b.id)}>
                    <Icons.pencil />
                  </button>
                  <button className="icon-btn icon-btn--sm" title="Duplicate" aria-label={`Duplicate ${b.name}`} onClick={run(() => void duplicateBoard(b.id))}>
                    <Icons.copy />
                  </button>
                  <button className="icon-btn icon-btn--sm" title="Delete" aria-label={`Delete ${b.name}`} onClick={run(() => remove(b))}>
                    <Icons.trash />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button role="menuitem" className="menu__item" onClick={run(() => void createBoard())}>
            <Icons.plus />
            <span>New board</span>
          </button>
          <div className="menu__divider" />
          <button role="menuitem" className="menu__item" onClick={run(exportBoard)}>
            <Icons.download />
            <span>Export as JSON</span>
            <kbd>Ctrl+S</kbd>
          </button>
          <button role="menuitem" className="menu__item" onClick={run(() => useBoard.getState().openExport())}>
            <Icons.image />
            <span>Export image (PNG / SVG)…</span>
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
          <button role="menuitem" className="menu__item" onClick={run(pickNewBoardFile)}>
            <Icons.upload />
            <span>Open JSON as a new board…</span>
          </button>
          <div className="menu__divider" />
          <button role="menuitem" className="menu__item" onClick={run(() => useBoard.getState().startPresenting())}>
            <Icons.play />
            <span>Present frames as slides</span>
            <kbd>{comboText(['Alt', 'P'])}</kbd>
          </button>
          <div className="menu__hint">Tip: drop a .json file on the canvas to add it there.</div>
        </div>
      )}
    </div>
  );
}

/** Inline board name editor: Enter or leaving the field saves, Esc cancels (`onDone(null)`). */
function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      ref={ref}
      className="board-row__rename"
      defaultValue={initial}
      aria-label="Board name"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value.trim());
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim())}
    />
  );
}
