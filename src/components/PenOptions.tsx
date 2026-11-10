import { useBoard } from '../store';
import { ERASER_MAX, ERASER_MIN, HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, PEN_COLORS, PEN_WIDTHS } from '../pen';
import { tooltip } from '../shortcuts';
import type { PenMode } from '../types';
import { Icons } from './Icons';

const MODES: { mode: PenMode; label: string; key: string[] }[] = [
  { mode: 'pen', label: 'Pen', key: ['P'] },
  { mode: 'highlighter', label: 'Highlighter', key: ['Shift', 'P'] },
  { mode: 'eraser', label: 'Eraser', key: ['E'] },
];

/**
 * Mode switch (pen / highlighter / eraser) plus color and width pickers, shown
 * next to the toolbar while the pen is active. The eraser has a size slider instead.
 */
export function PenOptions() {
  const tool = useBoard((s) => s.tool);
  const mode = useBoard((s) => s.penMode);
  const pen = useBoard((s) => s.pen);
  const highlighter = useBoard((s) => s.highlighter);
  const eraser = useBoard((s) => s.eraser);
  const { setPen, setHighlighter, setPenMode, setEraser } = useBoard.getState();
  if (tool !== 'pen') return null;

  const isHighlighter = mode === 'highlighter';
  const current = isHighlighter ? highlighter : pen;
  const update = isHighlighter ? setHighlighter : setPen;
  const colors = isHighlighter ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const widths = isHighlighter ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;

  return (
    <div className="pen-options" data-ui aria-label="Pen options">
      {MODES.map(({ mode: m, label, key }) => {
        const Icon = Icons[m];
        return (
          <button
            key={m}
            className={`pen-mode${mode === m ? ' pen-mode--active' : ''}`}
            title={tooltip(label, key)}
            aria-label={label}
            aria-pressed={mode === m}
            onClick={() => setPenMode(m)}
          >
            <Icon />
          </button>
        );
      })}
      {mode === 'eraser' && (
        <>
          <div className="divider divider--h" style={{ alignSelf: 'stretch' }} />
          {/* Preview of the eraser at its real size (capped to fit the panel). */}
          <div className="eraser-preview" aria-hidden="true">
            <span style={{ width: Math.min(eraser.size, 30), height: Math.min(eraser.size, 30) }} />
          </div>
          <input
            type="range"
            className="eraser-slider"
            min={ERASER_MIN}
            max={ERASER_MAX}
            step={1}
            value={eraser.size}
            aria-label="Eraser size"
            title={`Eraser size ${eraser.size}px`}
            onChange={(e) => setEraser({ size: Number(e.target.value) })}
            // Hand keyboard shortcuts (P, E, ...) back to the board after dragging.
            onPointerUp={(e) => e.currentTarget.blur()}
          />
          <span className="eraser-value">{eraser.size}</span>
        </>
      )}
      {mode !== 'eraser' && (
        <>
          <div className="divider divider--h" style={{ alignSelf: 'stretch' }} />
          {colors.map((c) => (
            <button
              key={c}
              className={`pen-swatch${current.color === c ? ' pen-swatch--active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`${isHighlighter ? 'Highlighter' : 'Pen'} color ${c}`}
              aria-pressed={current.color === c}
              onClick={() => update({ color: c })}
            />
          ))}
          <div className="divider divider--h" style={{ alignSelf: 'stretch' }} />
          {widths.map((w) => (
            <button
              key={w}
              className={`pen-width${current.width === w ? ' pen-width--active' : ''}`}
              title={`${w}px`}
              aria-label={`${isHighlighter ? 'Highlighter' : 'Pen'} width ${w}px`}
              aria-pressed={current.width === w}
              onClick={() => update({ width: w })}
            >
              {/* Highlighter widths are drawn at half size so they fit the button. */}
              <span style={{ height: isHighlighter ? w / 2 : w, background: current.color }} />
            </button>
          ))}
        </>
      )}
    </div>
  );
}
