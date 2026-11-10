import { useBoard } from './store';
import { commitActiveEdit } from './editing';
import { downloadJson, exportFileName, readBoardFile, serializeBoard } from './boardFile';
import type { Vec } from './types';

export type ImportMode = 'replace' | 'add';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Download the current board as a .json file. */
export function exportBoard() {
  commitActiveEdit();
  const { items, order, connectors, showNotice } = useBoard.getState();
  if (!order.length && !Object.keys(connectors).length) {
    showNotice('The board is empty, so there is nothing to export.', 'error');
    return;
  }
  downloadJson(serializeBoard(items, order, connectors), exportFileName());
  showNotice(`Exported ${plural(order.length, 'item')} and ${plural(Object.keys(connectors).length, 'connector')}.`);
}

/**
 * Import a board file. `replace` swaps the whole board (after confirming if it
 * has content); `add` drops the content in, centered on `at` (default: the
 * middle of the screen). Both are a single undo step.
 */
export async function importBoardFile(file: File, mode: ImportMode, at?: Vec) {
  commitActiveEdit();
  const s = useBoard.getState();
  let content;
  try {
    content = await readBoardFile(file);
  } catch (err) {
    s.showNotice(`Could not import "${file.name}": ${(err as Error).message}`, 'error');
    return;
  }

  const summary = `${plural(content.items.length, 'item')} and ${plural(content.connectors.length, 'connector')}`;
  const skipped = content.skipped ? ` (${plural(content.skipped, 'invalid entry', 'invalid entries')} skipped)` : '';

  if (mode === 'replace') {
    const hasContent = s.order.length > 0 || Object.keys(s.connectors).length > 0;
    if (hasContent && !window.confirm(`Replace the current board with "${file.name}"?\n\nYou can undo this with Ctrl+Z.`)) {
      return;
    }
    s.replaceBoard(content);
    s.showNotice(`Opened ${summary}${skipped}. Ctrl+Z to undo.`);
  } else {
    const { camera: c, viewport: v } = s;
    const center = at ?? { x: (v.w / 2 - c.x) / c.z, y: (v.h / 2 - c.y) / c.z };
    s.insertBoard(content, center);
    s.showNotice(`Added ${summary}${skipped}. Ctrl+Z to undo.`);
  }
}

/** Let the user pick a .json file, then import it. */
export function pickBoardFile(mode: ImportMode) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importBoardFile(file, mode);
  };
  input.click();
}
