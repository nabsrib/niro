import { useBoard } from '../store';
import { HANDLES, boundsOf } from '../geometry';
import type { Box, Camera } from '../types';
import { ContextToolbar } from './ContextToolbar';

const toScreen = (b: Box, c: Camera) => ({
  left: b.x * c.z + c.x,
  top: b.y * c.z + c.y,
  width: b.w * c.z,
  height: b.h * c.z,
});

/** Selection outline, resize handles and the floating context toolbar (screen space). */
export function SelectionOverlay() {
  const selected = useBoard((s) => s.selected);
  const items = useBoard((s) => s.items);
  const camera = useBoard((s) => s.camera);
  const editingId = useBoard((s) => s.editingId);
  const interacting = useBoard((s) => s.interacting);

  const sel = selected.map((id) => items[id]).filter(Boolean);
  const bounds = boundsOf(sel);
  if (!bounds) return null;
  const box = toScreen(bounds, camera);

  return (
    <>
      {sel.length > 1 &&
        sel.map((it) => <div key={it.id} className="sel-item" style={toScreen(it, camera)} />)}
      <div className="sel-box" style={box}>
        {!editingId &&
          Object.keys(HANDLES).map((h) => (
            <div key={h} data-handle={h} className={`handle handle--${h}`} />
          ))}
      </div>
      {!interacting && !editingId && <ContextToolbar box={box} ids={selected} />}
    </>
  );
}
