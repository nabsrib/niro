import { useBoard } from './store';
import { makeItem } from './defaults';
import { makeConnector } from './connectors';
import { PALETTE } from './colors';
import type { Connector, Item } from './types';

/**
 * Dev only (`window.niroStress(5000)` in the console): fill the board with
 * `count` stickies and shapes in a grid, with a connector between about every
 * third pair of neighbors, to test performance on big boards. One undo step,
 * so Ctrl+Z removes it all again.
 */
export function stress(count = 5000): string {
  const s = useBoard.getState();
  const cols = Math.ceil(Math.sqrt(count));
  const types = ['sticky', 'rect', 'ellipse'] as const;
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const it = makeItem(types[i % 3], (i % cols) * 300, Math.floor(i / cols) * 300);
    it.fill = PALETTE[i % 8];
    it.text = `#${i + 1}`;
    items.push(it);
  }
  const connectors: Connector[] = [];
  for (let i = 0; i + 1 < count; i++) {
    if (i % 3 === 0 && (i + 1) % cols !== 0) {
      connectors.push(
        makeConnector({ kind: 'item', itemId: items[i].id, side: 'right' }, { kind: 'item', itemId: items[i + 1].id, side: 'left' }),
      );
    }
  }
  s.checkpoint();
  useBoard.setState((st) => ({
    items: { ...st.items, ...Object.fromEntries(items.map((it) => [it.id, it])) },
    order: [...st.order, ...items.map((it) => it.id)],
    connectors: { ...st.connectors, ...Object.fromEntries(connectors.map((c) => [c.id, c])) },
  }));
  return `Added ${items.length} items and ${connectors.length} connectors (Ctrl+Z to remove).`;
}
