import { useBoard } from '../store';
import { PEN_COLORS, PEN_WIDTHS } from '../pen';

/** Color and width picker shown next to the toolbar while the pen is active. */
export function PenOptions() {
  const tool = useBoard((s) => s.tool);
  const pen = useBoard((s) => s.pen);
  const setPen = useBoard((s) => s.setPen);
  if (tool !== 'pen') return null;

  return (
    <div className="pen-options" data-ui aria-label="Pen options">
      {PEN_COLORS.map((c) => (
        <button
          key={c}
          className={`pen-swatch${pen.color === c ? ' pen-swatch--active' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={`Pen color ${c}`}
          aria-pressed={pen.color === c}
          onClick={() => setPen({ color: c })}
        />
      ))}
      <div className="divider divider--h" style={{ alignSelf: 'stretch' }} />
      {PEN_WIDTHS.map((w) => (
        <button
          key={w}
          className={`pen-width${pen.width === w ? ' pen-width--active' : ''}`}
          title={`${w}px`}
          aria-label={`Pen width ${w}px`}
          aria-pressed={pen.width === w}
          onClick={() => setPen({ width: w })}
        >
          <span style={{ height: w, background: pen.color }} />
        </button>
      ))}
    </div>
  );
}
