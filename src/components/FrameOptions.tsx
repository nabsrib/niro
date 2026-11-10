import { useBoard } from '../store';
import { FRAME_PRESETS } from '../frames';

/**
 * Preset picker shown next to the toolbar while the Frame tool is active, like
 * Miro's frame formats. Click the canvas to place a frame of that size (Custom
 * also drags to size); Slides creates a slide deck.
 */
export function FrameOptions() {
  const tool = useBoard((s) => s.tool);
  const preset = useBoard((s) => s.framePreset);
  const setFramePreset = useBoard((s) => s.setFramePreset);
  if (tool !== 'frame') return null;

  return (
    <div className="frame-options" data-ui aria-label="Frame formats">
      <div className="frame-options__title">Frame</div>
      {FRAME_PRESETS.map((p) => {
        // Small preview of the shape, fitted into an 18px box.
        const k = 18 / Math.max(p.w, p.h);
        return (
          <button
            key={p.id}
            className={`frame-preset${preset === p.id ? ' frame-preset--active' : ''}${p.id === 'slides' ? ' frame-preset--slides' : ''}`}
            aria-pressed={preset === p.id}
            title={
              p.id === 'slides'
                ? 'Slides: click the canvas to start a slide deck'
                : p.id === 'custom'
                  ? 'Custom: click for a default frame, or drag to size'
                  : `${p.label}: click the canvas to place a ${p.w}×${p.h} frame`
            }
            onClick={() => setFramePreset(p.id)}
          >
            <span className="frame-preset__shape">
              {p.id === 'slides' ? (
                <>
                  <span style={{ width: 8, height: 6 }} />
                  <span style={{ width: 8, height: 6 }} />
                </>
              ) : (
                <span style={{ width: p.w * k, height: p.h * k }} />
              )}
            </span>
            <span>{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
