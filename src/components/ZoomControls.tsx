import { useBoard } from '../store';
import { Icons } from './Icons';

const STEP = 1.25;

export function ZoomControls() {
  const z = useBoard((s) => s.camera.z);
  const { setZoom, zoomToFit } = useBoard.getState();

  return (
    <div className="zoom-controls" data-ui>
      <button className="icon-btn" title="Zoom out  Ctrl+-" aria-label="Zoom out" onClick={() => setZoom(z / STEP)}>
        <Icons.minus />
      </button>
      <button className="zoom-label" title="Reset to 100%  Ctrl+0" onClick={() => setZoom(1)}>
        {Math.round(z * 100)}%
      </button>
      <button className="icon-btn" title="Zoom in  Ctrl+=" aria-label="Zoom in" onClick={() => setZoom(z * STEP)}>
        <Icons.plus />
      </button>
      <button className="icon-btn" title="Fit to content  Shift+1" aria-label="Fit to content" onClick={zoomToFit}>
        <Icons.fit />
      </button>
    </div>
  );
}
