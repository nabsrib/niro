import { useBoard } from '../store';
import { renderOrder } from '../frames';
import { cullRect, keepRendered, visibleConnectors, visibleItems } from '../culling';

/**
 * Dev only: how many items and connectors are actually rendered versus on the
 * board, to check viewport culling (try `niroStress(5000)` in the console).
 */
export function DevStats() {
  const items = useBoard(
    (s) => visibleItems(renderOrder(s.order, s.items), s.items, cullRect(s.camera, s.viewport), keepRendered(s.selected, s.editingId)).length,
  );
  const totalItems = useBoard((s) => s.order.length);
  const connectors = useBoard(
    (s) => visibleConnectors(s.connectors, s.items, cullRect(s.camera, s.viewport), keepRendered(s.selected, s.editingId)).length,
  );
  const totalConnectors = useBoard((s) => Object.keys(s.connectors).length);
  return (
    <div className="dev-stats" aria-hidden="true">
      dev · rendering {items} / {totalItems} items · {connectors} / {totalConnectors} connectors
    </div>
  );
}
