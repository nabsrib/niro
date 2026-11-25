import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { LABEL_COLORS, LABEL_DEFAULTS, LABEL_SIZES, bendsOf } from '../connectors';
import { deckSlides, isDeck, isFrame } from '../frames';
import { PALETTE } from '../colors';
import { type ArrowHead, type Connector, type TreeLayout, type ConnectorStyle, type Item, type LineDash } from '../types';

/** Menu wording for each end shape, at the start and at the end of a line. */
const HEAD_LABELS: Record<ArrowHead, { start: string; end: string }> = {
  none: { start: '━ No start', end: '━ No end' },
  arrow: { start: '◀ Arrow', end: '▶ Arrow' },
  open: { start: '‹ Open arrow', end: '› Open arrow' },
  circle: { start: '● Dot', end: '● Dot' },
  diamond: { start: '◆ Diamond', end: '◆ Diamond' },
  bar: { start: '┃ Bar', end: '┃ Bar' },
  triangle: { start: '◁ Inherits (hollow triangle)', end: '▷ Inherits (hollow triangle)' },
  hollowDiamond: { start: '◇ Has (hollow diamond)', end: '◇ Has (hollow diamond)' },
  one: { start: '‖ Exactly one', end: '‖ Exactly one' },
  zeroOne: { start: '○| Zero or one', end: '|○ Zero or one' },
  many: { start: '⋲ Many', end: '⋺ Many' },
  oneMany: { start: '|⋲ One or many', end: '⋺| One or many' },
  zeroMany: { start: '○⋲ Zero or many', end: '⋺○ Zero or many' },
};

/** End shapes in the line menus, in groups. */
const HEAD_GROUPS: { label: string; heads: ArrowHead[] }[] = [
  { label: 'Basic', heads: ['none', 'arrow', 'open', 'circle', 'diamond', 'bar'] },
  { label: 'UML', heads: ['triangle', 'hollowDiamond'] },
  { label: 'Database (crow’s foot)', heads: ['one', 'zeroOne', 'many', 'oneMany', 'zeroMany'] },
];
import { Icons } from './Icons';
import { TextOptions } from './TextOptions';
import { ShapeStyle } from './ShapeStyle';
import { myIdentity } from '../identity';
import { normalizeUrl, openLink } from '../links';
import { hasText } from '../textStyle';
import { tooltip } from '../shortcuts';
import { saveSelectionAsTemplate } from '../templateActions';
import { isCompartmentShape, shapeOf } from '../shapes';
import { treeLayoutOf, treeRootOf } from '../trees';

type ScreenBox = { left: number; top: number; width: number; height: number };

const STYLES: { style: ConnectorStyle; label: string; Icon: () => React.JSX.Element }[] = [
  { style: 'straight', label: 'Straight line', Icon: Icons.lineStraight },
  { style: 'elbow', label: 'Elbow line', Icon: Icons.lineElbow },
  { style: 'curved', label: 'Curved line', Icon: Icons.lineCurved },
];

/** Floating toolbar above the current selection (items and/or connectors). */
/**
 * Toolbar above the selection. With `editing` (typing in a sticky, shape or
 * text) it shows only the text options, which then style the selected part
 * of the text.
 */
export function ContextToolbar({ box, ids, editing = false }: { box: ScreenBox; ids: string[]; editing?: boolean }) {
  const s = useBoard.getState();
  const items = useBoard((st) => st.items);
  const connectors = useBoard((st) => st.connectors);
  const selItems = ids.map((id) => items[id]).filter(Boolean);
  const selConns = ids.map((id) => connectors[id]).filter(Boolean);

  const first = selItems[0];
  const singleFrame = ids.length === 1 && isFrame(first) ? first : undefined;
  // One mind map node selected: its tree tools (the layout choice lives on the root).
  const treeNode = ids.length === 1 && first?.tree ? first : undefined;
  const treeRootId = treeNode ? treeRootOf(items, treeNode.id) : null;
  const treeRoot = treeRootId ? items[treeRootId] : undefined;
  const current = first
    ? first.type === 'text' || first.type === 'path'
      ? first.color
      : first.fill
    : selConns[0]?.stroke;
  const connIds = selConns.map((c) => c.id);
  const allStyle = (style: ConnectorStyle) => selConns.length > 0 && selConns.every((c) => c.style === style);
  // The value shown in a menu: shared by all selected connectors, or '' when they differ.
  const common = <T,>(get: (c: Connector) => T): T | '' => {
    const vals = new Set(selConns.map(get));
    return vals.size === 1 ? [...vals][0] : '';
  };
  const startHead = common((c) => c.startArrow);
  const endHead = common((c) => c.endArrow);
  const dash = common((c) => c.dash ?? 'solid');
  const bentIds = selConns.filter((c) => bendsOf(c).length > 0 || c.channel).map((c) => c.id);

  // Label text options (size, color) apply to every selected connector that has a label or end labels.
  const labeled = selConns.filter((c) => c.label || c.startLabel || c.endLabel);
  const labeledIds = labeled.map((c) => c.id);
  const sizes = new Set(labeled.map((c) => c.labelSize ?? LABEL_DEFAULTS.size));
  const labelSize = sizes.size === 1 ? [...sizes][0] : null;
  const sizeOptions =
    labelSize !== null && !LABEL_SIZES.includes(labelSize)
      ? [...LABEL_SIZES, labelSize].sort((a, b) => a - b)
      : LABEL_SIZES;
  const labelColor = labeled[0]?.labelColor ?? LABEL_DEFAULTS.color;
  const [colorsOpen, setColorsOpen] = useState(false);
  const selectionKey = ids.join(',');
  useEffect(() => setColorsOpen(false), [selectionKey]);

  // Flip below the selection when there is no room above it.
  const above = box.top > 70;
  const style = {
    left: box.left + box.width / 2,
    top: above ? box.top - 14 : box.top + box.height + 14,
    transform: `translate(-50%, ${above ? '-100%' : '0'})`,
  };

  // Locked items: only unlock and duplicate (nothing else may change them).
  if (!editing && selItems.some((it) => it.locked)) {
    return (
      <div className="context-toolbar" style={style} data-ui onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn icon-btn--active" title={tooltip('Unlock', ['Mod', 'Shift', 'L'])} aria-label="Unlock" onClick={() => toggleLock(selItems)}>
          <Icons.unlock />
        </button>
        <button className="icon-btn" title="Duplicate  Ctrl+D" onClick={() => s.duplicate(ids)}>
          <Icons.copy />
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div
        className="context-toolbar"
        style={style}
        data-ui
        data-text-toolbar
        onPointerDown={(e) => e.stopPropagation()}
        // Keep the editor focused and its text selected (the size menu still opens).
        onMouseDown={(e) => {
          if (!(e.target as Element).closest('select')) e.preventDefault();
        }}
      >
        <TextOptions items={selItems} editing />
        {selItems.length === 1 && selItems[0].type === 'rect' && isCompartmentShape(shapeOf(selItems[0])) && (
          <span className="toolbar-hint">
            {shapeOf(selItems[0]) === 'entity'
              ? 'First line: table name · one column per line'
              : 'New section: press Enter twice, or type --'}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="context-toolbar" style={style} data-ui onPointerDown={(e) => e.stopPropagation()}>
      {selConns.length > 0 && (
        <>
          {STYLES.map(({ style: st, label, Icon }) => (
            <button
              key={st}
              className={`icon-btn${allStyle(st) ? ' icon-btn--active' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={allStyle(st)}
              onClick={() => s.styleConnectors(connIds, { style: st })}
            >
              <Icon />
            </button>
          ))}
          <div className="divider" />
          <select
            className="font-size line-select"
            value={startHead}
            title="Start of the line"
            aria-label="Start of the line"
            onChange={(e) => s.styleConnectors(connIds, { startArrow: e.target.value as ArrowHead })}
          >
            {startHead === '' && <option value="">Start…</option>}
            {HEAD_GROUPS.map((grp) => (
              <optgroup key={grp.label} label={grp.label}>
                {grp.heads.map((h) => (
                  <option key={h} value={h}>
                    {HEAD_LABELS[h].start}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            className="font-size line-select"
            value={endHead}
            title="End of the line"
            aria-label="End of the line"
            onChange={(e) => s.styleConnectors(connIds, { endArrow: e.target.value as ArrowHead })}
          >
            {endHead === '' && <option value="">End…</option>}
            {HEAD_GROUPS.map((grp) => (
              <optgroup key={grp.label} label={grp.label}>
                {grp.heads.map((h) => (
                  <option key={h} value={h}>
                    {HEAD_LABELS[h].end}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            className="font-size line-select"
            value={dash}
            title="Line pattern"
            aria-label="Line pattern"
            onChange={(e) =>
              s.styleConnectors(connIds, { dash: e.target.value === 'solid' ? null : (e.target.value as LineDash) })
            }
          >
            {dash === '' && <option value="">Pattern…</option>}
            <option value="solid">━━ Solid</option>
            <option value="dashed">╍╍ Dashed</option>
            <option value="dotted">┈┈ Dotted</option>
          </select>
          {bentIds.length > 0 && (
            <button
              className="icon-btn"
              title="Reset line (remove bends)"
              aria-label="Reset line"
              onClick={() => s.styleConnectors(bentIds, { bends: null, bend: null, channel: null })}
            >
              <Icons.resetCurve />
            </button>
          )}
          {selConns.length === 1 && (
            <button
              className={`icon-btn${selConns[0].label ? ' icon-btn--active' : ''}`}
              title={tooltip(selConns[0].label ? 'Edit label' : 'Add label', ['Enter'])}
              aria-label={selConns[0].label ? 'Edit label' : 'Add label'}
              onClick={() => s.startEditing(selConns[0].id)}
            >
              <Icons.text />
            </button>
          )}
          {selConns.length === 1 && (
            <span className="end-labels" title="Small text at each end, like 1, * or 0..1 in UML">
              {(['startLabel', 'endLabel'] as const).map((key) => (
                <input
                  key={key}
                  className="end-labels__input"
                  value={selConns[0][key] ?? ''}
                  placeholder={key === 'startLabel' ? 'start' : 'end'}
                  maxLength={40}
                  aria-label={key === 'startLabel' ? 'Text at the start of the line' : 'Text at the end of the line'}
                  // One undo step per edit of a box.
                  onFocus={() => s.checkpoint()}
                  onChange={(e) => {
                    const v = e.target.value || undefined;
                    s.updateConnector(selConns[0].id, key === 'startLabel' ? { startLabel: v } : { endLabel: v });
                  }}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
                />
              ))}
            </span>
          )}
          {labeled.length > 0 && (
            <>
              <select
                className="font-size"
                value={labelSize ?? ''}
                title="Label text size"
                aria-label="Label text size"
                onChange={(e) => {
                  s.styleConnectors(labeledIds, { labelSize: Number(e.target.value) });
                  // Hand keyboard shortcuts back to the board.
                  e.currentTarget.blur();
                }}
              >
                {labelSize === null && <option value="">–</option>}
                {sizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <div className="text-color">
                <button
                  className={`icon-btn${colorsOpen ? ' icon-btn--active' : ''}`}
                  title="Label text color"
                  aria-label="Label text color"
                  aria-expanded={colorsOpen}
                  onClick={() => setColorsOpen((o) => !o)}
                >
                  <span className="text-color__glyph">
                    A
                    <span className="text-color__bar" style={{ background: labelColor }} />
                  </span>
                </button>
                {colorsOpen && (
                  <div className="text-color__menu">
                    {LABEL_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`swatch${labelColor.toLowerCase() === c.toLowerCase() ? ' swatch--active' : ''}`}
                        style={{ background: c }}
                        title={c}
                        aria-label={`Label color ${c}`}
                        onClick={() => {
                          s.styleConnectors(labeledIds, { labelColor: c });
                          setColorsOpen(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="divider" />
        </>
      )}
      {/* Frame actions, like Miro's frame menu: present, focus, hide; decks: play, add slide. */}
      {singleFrame && (
        <>
          {isDeck(singleFrame) ? (
            <>
              <button
                className="icon-btn"
                title={tooltip('Present this deck', ['Alt', 'P'])}
                aria-label="Present this deck"
                onClick={() => {
                  const st = useBoard.getState();
                  const start = deckSlides(singleFrame, st.items, st.order).find((f) => !f.skipSlide);
                  s.startPresenting(start?.id);
                }}
              >
                <Icons.play />
              </button>
              <button
                className="icon-btn"
                title="Add a blank slide"
                aria-label="Add a blank slide"
                onClick={() => s.addSlide(singleFrame.id)}
              >
                <Icons.plus />
              </button>
            </>
          ) : (
            <>
              <button
                className="icon-btn"
                title={singleFrame.skipSlide ? 'Hidden from the presentation' : tooltip('Present from this frame', ['Alt', 'P'])}
                aria-label="Present from this frame"
                disabled={!!singleFrame.skipSlide}
                onClick={() => s.startPresenting(singleFrame.id)}
              >
                <Icons.play />
              </button>
              <button
                className="icon-btn"
                title="Focus mode: dim everything outside this frame"
                aria-label="Focus on this frame"
                onClick={() => s.setFocus(singleFrame.id)}
              >
                <Icons.focus />
              </button>
              <button
                className={`icon-btn${singleFrame.skipSlide ? ' icon-btn--active' : ''}`}
                title={singleFrame.skipSlide ? 'Show in presentation' : 'Hide from presentation'}
                aria-label={singleFrame.skipSlide ? 'Show in presentation' : 'Hide from presentation'}
                aria-pressed={!!singleFrame.skipSlide}
                onClick={() => s.setSkipSlide(singleFrame.id, !singleFrame.skipSlide)}
              >
                {singleFrame.skipSlide ? <Icons.eyeOff /> : <Icons.eye />}
              </button>
            </>
          )}
          <button
            className={`icon-btn${singleFrame.clip ? ' icon-btn--active' : ''}`}
            title={singleFrame.clip ? 'Stop clipping contents' : 'Clip contents (cut off what sticks out)'}
            aria-label="Clip contents"
            aria-pressed={!!singleFrame.clip}
            onClick={() => s.restyleItems([singleFrame.id], (f) => ({ clip: f.clip ? undefined : true }))}
          >
            <Icons.crop />
          </button>
          <button
            className={`icon-btn${singleFrame.hiddenBy ? ' icon-btn--active' : ''}`}
            title={singleFrame.hiddenBy ? 'Reveal to everyone' : 'Hide from others (only you see it)'}
            aria-label="Hide frame from others"
            aria-pressed={!!singleFrame.hiddenBy}
            onClick={() => s.restyleItems([singleFrame.id], (f) => ({ hiddenBy: f.hiddenBy ? undefined : myIdentity() }))}
          >
            <Icons.hide />
          </button>
          <button
            className="icon-btn"
            title="Copy link to this frame"
            aria-label="Copy link to this frame"
            onClick={() => copyFrameLink(singleFrame.id)}
          >
            <Icons.link />
          </button>
          {!isDeck(singleFrame) && (
            <button
              className="icon-btn"
              title="Fit frame to its contents"
              aria-label="Fit frame to its contents"
              onClick={() => {
                if (!s.fitFrameToContent(singleFrame.id)) s.showNotice('This frame is empty, so there is nothing to fit.');
              }}
            >
              <Icons.fit />
            </button>
          )}
          {!isDeck(singleFrame) && (
            <button
              className={`icon-btn${singleFrame.stack ? ' icon-btn--active' : ''}`}
              title={singleFrame.stack ? 'Stop stacking cards' : 'Stack cards (kanban column): what is inside lines up in one column'}
              aria-label="Stack cards"
              aria-pressed={!!singleFrame.stack}
              onClick={() => {
                s.restyleItems([singleFrame.id], () => ({ stack: singleFrame.stack ? undefined : true }));
                s.layoutDecks();
              }}
            >
              <Icons.stack />
            </button>
          )}
          <button
            className="icon-btn"
            title="Export this frame as an image"
            aria-label="Export this frame as an image"
            onClick={() => s.openExport({ kind: 'frame', frameId: singleFrame.id })}
          >
            <Icons.image />
          </button>
          <div className="divider" />
        </>
      )}
      {/* A link card: open it, change its title or address. */}
      {selConns.length === 0 && selItems.length === 1 && selItems[0].type === 'link' && (
        <>
          <button className="icon-btn" title="Open link in a new tab" aria-label="Open link" onClick={() => openLink(selItems[0].url)}>
            <Icons.external />
          </button>
          <button
            className="icon-btn"
            title="Edit title"
            aria-label="Edit title"
            onClick={() => {
              const title = window.prompt('Title of the link card:', selItems[0].text);
              if (title !== null) s.restyleItems([selItems[0].id], () => ({ text: title.trim().slice(0, 200) }));
            }}
          >
            <Icons.text />
          </button>
          <button
            className="icon-btn"
            title="Edit web address"
            aria-label="Edit web address"
            onClick={() => {
              const raw = window.prompt('Web address:', selItems[0].url);
              if (raw === null) return;
              const url = normalizeUrl(raw);
              if (url) s.restyleItems([selItems[0].id], () => ({ url }));
              else s.showNotice('That doesn’t look like a web address (http or https).', 'error');
            }}
          >
            <Icons.link />
          </button>
          <div className="divider" />
        </>
      )}
      {/* Text options when only stickies, shapes and text are selected. */}
      {selConns.length === 0 && selItems.length > 0 && selItems.every(hasText) && <TextOptions items={selItems} />}
      {/* Shape and border when only rectangles and ellipses are selected. */}
      {selConns.length === 0 && selItems.length > 0 && selItems.every((it) => it.type === 'rect' || it.type === 'ellipse') && (
        <>
          <div className="divider" />
          <ShapeStyle items={selItems} />
          <div className="divider" />
        </>
      )}
      {treeNode && (
        <>
          <button className="icon-btn" title="Add a child  Tab" aria-label="Add a child" onClick={() => s.addTreeNode(treeNode.id, 'child')}>
            <Icons.addChild />
          </button>
          {treeNode.tree?.parent && (
            <button
              className="icon-btn"
              title="Add a sibling  (Enter while typing)"
              aria-label="Add a sibling"
              onClick={() => s.addTreeNode(treeNode.id, 'sibling')}
            >
              <Icons.addSibling />
            </button>
          )}
          {treeRoot && (
            <select
              className="font-size line-select"
              value={treeLayoutOf(treeRoot)}
              title="Layout of this mind map"
              aria-label="Layout of this mind map"
              onChange={(e) => {
                s.setTreeLayout(treeRoot.id, e.target.value as TreeLayout);
                e.currentTarget.blur();
              }}
            >
              <option value="mind">Mind map (both sides)</option>
              <option value="right">Mind map (right side)</option>
              <option value="org">Org chart (top-down)</option>
            </select>
          )}
          <div className="divider" />
        </>
      )}
      {!treeNode && selItems.length === 1 && selConns.length === 0 && ['rect', 'ellipse', 'sticky'].includes(first.type) && (
        <button
          className="icon-btn"
          title="Start a mind map from this  M"
          aria-label="Start a mind map from this"
          onClick={() => s.startMindMap({ x: 0, y: 0 }, first.id)}
        >
          <Icons.mindmap />
        </button>
      )}
      {/* Colors don't apply to images (a selection of only images has no palette). */}
      {!(selConns.length === 0 && selItems.length > 0 && selItems.every((it) => it.type === 'image' || it.type === 'emoji')) && (
        <>
          <div className="swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch${current?.toLowerCase() === c.toLowerCase() ? ' swatch--active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => s.setColor(ids.filter((id) => items[id]?.type !== 'image'), c)}
              />
            ))}
          </div>
          <div className="divider" />
        </>
      )}
      {selItems.length > 0 && (
        <>
          <button className="icon-btn" title="Bring to front  ]" onClick={() => s.reorder(ids, 'front')}>
            <Icons.front />
          </button>
          <button className="icon-btn" title="Send to back  [" onClick={() => s.reorder(ids, 'back')}>
            <Icons.back />
          </button>
        </>
      )}
      {selItems.length > 0 && (
        <button className="icon-btn" title={tooltip('Lock', ['Mod', 'Shift', 'L'])} aria-label="Lock" onClick={() => toggleLock(selItems)}>
          <Icons.lock />
        </button>
      )}
      {selItems.length > 0 && (
        <button
          className="icon-btn"
          title="Save as template"
          aria-label="Save as template"
          onClick={() => void saveSelectionAsTemplate()}
        >
          <Icons.saveTemplate />
        </button>
      )}
      <button className="icon-btn" title="Duplicate  Ctrl+D" onClick={() => s.duplicate(ids)}>
        <Icons.copy />
      </button>
      <button className="icon-btn" title="Delete  Del" onClick={() => s.deleteItems(ids)}>
        <Icons.trash />
      </button>
    </div>
  );
}

/** Lock the items, or unlock them all if any is locked. One undo step. */
export function toggleLock(selItems: Item[]) {
  const unlock = selItems.some((it) => it.locked);
  useBoard.getState().restyleItems(
    selItems.map((it) => it.id),
    () => ({ locked: unlock ? undefined : true }),
  );
}

/** Copy a link that opens this board zoomed to the frame (`#board=<id>&frame=<id>`). */
function copyFrameLink(frameId: string) {
  const { boardId, showNotice } = useBoard.getState();
  if (!boardId) return;
  const url = `${location.origin}${location.pathname}#board=${boardId}&frame=${frameId}`;
  void navigator.clipboard.writeText(url).then(
    () => showNotice('Link to this frame copied.'),
    () => showNotice('Could not copy the link.', 'error'),
  );
}
