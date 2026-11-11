import { useEffect, useRef } from 'react';
import { useBoard } from '../store';
import { exportPixels, exportPrefs } from '../exportActions';
import type { Box } from '../types';

/** Shapes the export window can be locked to (width / height); 'free' is unlocked. */
const RATIOS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: 'a4', label: 'A4', ratio: 595 / 842 },
];

type Dir = { x: -1 | 0 | 1; y: -1 | 0 | 1 };
const EDGES: Dir[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 },
  { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 },
];
const CURSORS: Record<string, string> = {
  '-1,-1': 'nwse-resize', '1,1': 'nwse-resize', '1,-1': 'nesw-resize', '-1,1': 'nesw-resize',
  '0,-1': 'ns-resize', '0,1': 'ns-resize', '-1,0': 'ew-resize', '1,0': 'ew-resize',
};
/** Smallest window, in screen pixels. */
const MIN_PX = 40;

type Drag = { mode: 'move' } | { mode: 'resize'; dir: Dir };

/**
 * Custom export area: an adjustable window on the board (drag inside to move,
 * edges and corners to resize, ratio chips to lock its shape). Everything
 * outside is dimmed. It lives in the canvas overlay, so scrolling and zooming
 * the board still work while adjusting. Done goes back to the export dialog.
 */
export function RegionPicker() {
  const pick = useBoard((s) => s.regionPick);
  const camera = useBoard((s) => s.camera);
  const drag = useRef<{ kind: Drag; startX: number; startY: number; box: Box } | null>(null);

  // Esc cancels, Enter confirms (and nothing else reacts to them meanwhile).
  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      useBoard.getState().finishRegionPick(e.key === 'Enter');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pick]);

  if (!pick) return null;
  const { box, ratio: ratioId } = pick;
  const ratio = RATIOS.find((r) => r.id === ratioId)?.ratio ?? null;
  const set = useBoard.getState().setRegionPick;
  const rect = {
    left: box.x * camera.z + camera.x,
    top: box.y * camera.z + camera.y,
    width: box.w * camera.z,
    height: box.h * camera.z,
  };
  const size = exportPixels({ kind: 'region', box }, exportPrefs.format, exportPrefs.scale);

  const begin = (kind: Drag) => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, startX: e.clientX, startY: e.clientY, box };
  };

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const z = useBoard.getState().camera.z;
    const dx = (e.clientX - d.startX) / z;
    const dy = (e.clientY - d.startY) / z;
    const b = d.box;
    if (d.kind.mode === 'move') {
      set({ box: { ...b, x: b.x + dx, y: b.y + dy } });
      return;
    }
    set({ box: resize(b, d.kind.dir, dx, dy, ratio, MIN_PX / z) });
  };

  const end = (e: React.PointerEvent<HTMLElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const pickRatio = (id: string, r: number | null) => {
    if (r === null) {
      set({ ratio: id });
      return;
    }
    // Keep the center and the width; the height follows the ratio.
    const h = box.w / r;
    set({ ratio: id, box: { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h } });
  };

  const handles = ratio === null ? EDGES : EDGES.filter((d) => d.x !== 0 && d.y !== 0);

  return (
    <>
      <div className="region-mask" style={rect} aria-hidden="true" />
      <div
        className="region-window"
        data-ui
        style={rect}
        title="Drag to move · drag the edges to resize"
        onPointerDown={begin({ mode: 'move' })}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {handles.map((d) => (
          <span
            key={`${d.x},${d.y}`}
            className="region-handle"
            style={{ left: `${(d.x + 1) * 50}%`, top: `${(d.y + 1) * 50}%`, cursor: CURSORS[`${d.x},${d.y}`] }}
            onPointerDown={begin({ mode: 'resize', dir: d })}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </div>
      <div className="region-bar" data-ui>
        <span className="region-bar__title">Export area</span>
        <div className="segmented">
          {RATIOS.map((r) => (
            <button key={r.id} className={ratioId === r.id ? 'is-active' : ''} aria-pressed={ratioId === r.id} onClick={() => pickRatio(r.id, r.ratio)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="region-bar__size">
          {size
            ? `${size.w} × ${size.h} px${exportPrefs.format === 'png' ? ` at ${size.scale < exportPrefs.scale - 0.01 ? size.scale.toFixed(2) : exportPrefs.scale}×` : ''}`
            : 'Nothing inside yet'}
        </span>
        <button className="btn" onClick={() => useBoard.getState().finishRegionPick(false)}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={!size} onClick={() => useBoard.getState().finishRegionPick(true)}>
          Done
        </button>
      </div>
    </>
  );
}

/**
 * Resize `b` by dragging the edge/corner `dir` by (dx, dy). With a ratio,
 * corners keep the shape, anchored at the opposite corner.
 */
function resize(b: Box, dir: Dir, dx: number, dy: number, ratio: number | null, min: number): Box {
  let x1 = b.x;
  let y1 = b.y;
  let x2 = b.x + b.w;
  let y2 = b.y + b.h;
  if (ratio !== null && dir.x !== 0 && dir.y !== 0) {
    const ax = dir.x < 0 ? x2 : x1;
    const ay = dir.y < 0 ? y2 : y1;
    const px = (dir.x < 0 ? x1 : x2) + dx;
    const py = (dir.y < 0 ? y1 : y2) + dy;
    const w = Math.max(Math.abs(px - ax), Math.abs(py - ay) * ratio, min);
    const h = w / ratio;
    return { x: dir.x < 0 ? ax - w : ax, y: dir.y < 0 ? ay - h : ay, w, h };
  }
  if (dir.x < 0) x1 = Math.min(x1 + dx, x2 - min);
  if (dir.x > 0) x2 = Math.max(x2 + dx, x1 + min);
  if (dir.y < 0) y1 = Math.min(y1 + dy, y2 - min);
  if (dir.y > 0) y2 = Math.max(y2 + dy, y1 + min);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
