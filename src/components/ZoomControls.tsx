import { useBoard } from '../store';
import { Icons } from './Icons';
import { tooltip } from '../shortcuts';

const STEP = 1.25;

export function ZoomControls() {
  const z = useBoard((s) => s.camera.z);
  const { setZoom, zoomToFit } = useBoard.getState();

  return (
    <div className="zoom-controls" data-ui>
      <button className="icon-btn" title={tooltip('Zoom out', ['Mod', '-'])} aria-label="Zoom out" onClick={() => setZoom(z / STEP)}>
        <Icons.minus />
      </button>
      <button className="zoom-label" title={tooltip('Reset to 100%', ['Mod', '0'])} onClick={() => setZoom(1)}>
        {Math.round(z * 100)}%
      </button>
      <button className="icon-btn" title={tooltip('Zoom in', ['Mod', '='])} aria-label="Zoom in" onClick={() => setZoom(z * STEP)}>
        <Icons.plus />
      </button>
      <button className="icon-btn" title={tooltip('Fit to content', ['Shift', '1'])} aria-label="Fit to content" onClick={zoomToFit}>
        <Icons.fit />
      </button>
    </div>
  );
}
