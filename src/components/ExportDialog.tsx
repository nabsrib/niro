import { useEffect, useMemo, useState } from 'react';
import { useBoard } from '../store';
import { isFrame } from '../frames';
import { exportPixels, runExport, type ExportBackground } from '../exportActions';
import type { ExportArea } from '../exportImage';

type Format = 'png' | 'svg';
const SCALES = [1, 2, 3];

/**
 * Export image dialog (niro menu → Export image…, or a frame's toolbar).
 * PNG keeps text exactly as on the board; SVG splits text into lines so it
 * opens correctly in design tools.
 */
export function ExportDialog() {
  const initial = useBoard((s) => s.exportDialog);
  if (!initial) return null;
  return <Dialog initial={initial} />;
}

function Dialog({ initial }: { initial: ExportArea }) {
  const items = useBoard((s) => s.items);
  const selected = useBoard((s) => s.selected);
  const connectors = useBoard((s) => s.connectors);
  const close = useBoard((s) => s.closeExport);
  const [format, setFormat] = useState<Format>('png');
  const [area, setArea] = useState<ExportArea>(initial);
  const [scale, setScale] = useState(2);
  const [background, setBackground] = useState<ExportBackground>('white');
  const [busy, setBusy] = useState(false);

  const frameId = selected.length === 1 && isFrame(items[selected[0]]) ? selected[0] : initial.kind === 'frame' ? initial.frameId : null;
  const hasSelection = selected.some((id) => items[id] || connectors[id]);
  const size = useMemo(() => exportPixels(area, format, scale), [area, format, scale, items, connectors, selected]);

  // Esc closes the dialog only (not the selection).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const doExport = async () => {
    setBusy(true);
    await runExport({ area, format, scale, background });
    setBusy(false);
    close();
  };

  const areaOptions: { key: string; label: string; area: ExportArea; disabled?: boolean }[] = [
    { key: 'board', label: 'Whole board', area: { kind: 'board' } },
    { key: 'selection', label: 'Selection', area: { kind: 'selection' }, disabled: !hasSelection },
    ...(frameId
      ? [{ key: 'frame', label: `Frame: ${items[frameId]?.text || 'Frame'}`, area: { kind: 'frame' as const, frameId } }]
      : []),
  ];

  return (
    <div className="modal-backdrop" data-ui onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="export-dialog" role="dialog" aria-label="Export image">
        <div className="export-dialog__header">
          <span>Export image</span>
          <button className="icon-btn icon-btn--sm" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>

        <div className="export-dialog__row">
          <span className="export-dialog__label">Format</span>
          <div className="segmented">
            {(['png', 'svg'] as const).map((f) => (
              <button key={f} className={format === f ? 'is-active' : ''} aria-pressed={format === f} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <p className="export-dialog__help">
          {format === 'png'
            ? 'A picture for chats, docs and slides. Text looks exactly like the board.'
            : 'A vector image that stays sharp at any size and opens in Figma, Illustrator or Inkscape.'}
        </p>

        <div className="export-dialog__row export-dialog__row--top">
          <span className="export-dialog__label">Area</span>
          <div className="export-dialog__options">
            {areaOptions.map((o) => (
              <label key={o.key} className={`radio${o.disabled ? ' radio--disabled' : ''}`}>
                <input
                  type="radio"
                  name="export-area"
                  checked={area.kind === o.area.kind}
                  disabled={o.disabled}
                  onChange={() => setArea(o.area)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>

        {format === 'png' && (
          <div className="export-dialog__row">
            <span className="export-dialog__label">Size</span>
            <div className="segmented">
              {SCALES.map((k) => (
                <button key={k} className={scale === k ? 'is-active' : ''} aria-pressed={scale === k} onClick={() => setScale(k)}>
                  {k}×
                </button>
              ))}
            </div>
            {size && (
              <span className="export-dialog__dims">
                {size.w} × {size.h} px
              </span>
            )}
          </div>
        )}

        {format === 'png' && size?.shrunk && (
          <p className="export-dialog__help export-dialog__warn">
            This area is very large, so the PNG is shrunk to {size.scale.toFixed(2)}× to fit the browser&apos;s image size
            limit. Titles and lines stay readable; for full detail, export a frame or the selection, or use SVG.
          </p>
        )}

        <div className="export-dialog__row">
          <span className="export-dialog__label">Background</span>
          <div className="segmented">
            {(
              [
                ['white', 'White'],
                ['board', 'Board'],
                ['transparent', 'Transparent'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={background === key ? 'is-active' : ''}
                aria-pressed={background === key}
                title={key === 'board' ? 'The grey of the canvas, so white frames stand out like on the board' : undefined}
                onClick={() => setBackground(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="export-dialog__footer">
          {!size && <span className="export-dialog__empty">Nothing to export in this area.</span>}
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled={!size || busy} onClick={() => void doExport()}>
            {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
