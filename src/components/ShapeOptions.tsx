import { useBoard } from '../store';
import { SHAPES, shapePath } from '../shapes';
import type { ShapeKind } from '../types';

/** A small outline of a shape, for buttons and menus. */
export function ShapeIcon({ kind, size = 18 }: { kind: ShapeKind; size?: number }) {
  const w = kind === 'arrow' || kind === 'bubble' || kind === 'parallelogram' ? size : size * 0.9;
  const h =
    kind === 'arrow' ? size * 0.6 : kind === 'pill' ? size * 0.5 : kind === 'cylinder' || kind === 'actor' ? size : size * 0.8;
  const x0 = (size - w) / 2;
  const y0 = (size - h) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {kind === 'entity' && <rect x={x0} y={y0} width={w} height={h * 0.3} fill="currentColor" opacity={0.35} />}
      <path
        transform={`translate(${x0} ${y0})`}
        d={shapePath(kind, w, h, 0.75)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {(kind === 'class' || kind === 'entity') && (
        <path
          d={kind === 'class' ? `M ${x0} ${y0 + h * 0.33} h ${w} M ${x0} ${y0 + h * 0.66} h ${w}` : `M ${x0} ${y0 + h * 0.3} h ${w}`}
          stroke="currentColor"
          strokeWidth={1.2}
        />
      )}
    </svg>
  );
}

/**
 * Shape picker next to the toolbar while the Rectangle tool is active, like
 * Miro's shapes: pick one, then click the canvas to place it or drag to size.
 */
export function ShapeOptions() {
  const tool = useBoard((s) => s.tool);
  const kind = useBoard((s) => s.shapeKind);
  const setShapeKind = useBoard((s) => s.setShapeKind);
  if (tool !== 'rect') return null;

  return (
    <div className="frame-options shape-options" data-ui aria-label="Shapes">
      <div className="frame-options__title">Shapes</div>
      <div className="shape-options__grid">
        {SHAPES.map((s) => (
          <button
            key={s.kind}
            className={`shape-choice${kind === s.kind ? ' frame-preset--active' : ''}`}
            aria-pressed={kind === s.kind}
            title={`${s.label}: click the canvas to place it, or drag to size`}
            onClick={() => setShapeKind(s.kind)}
          >
            <ShapeIcon kind={s.kind} size={22} />
          </button>
        ))}
      </div>
    </div>
  );
}
