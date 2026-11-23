import { useBoard } from '../store';
import { Icons } from './Icons';
import { commitActiveEdit } from '../editing';
import { TOOL_SHORTCUTS, tooltip } from '../shortcuts';
import { pickImageFiles } from '../images';
import { ShapeIcon } from './ShapeOptions';
import { toggleEmojiPicker, useEmojiPicker } from './EmojiPicker';
import { askForLink } from '../links';

export function Toolbar() {
  const tool = useBoard((s) => s.tool);
  const penMode = useBoard((s) => s.penMode);
  const shapeKind = useBoard((s) => s.shapeKind);
  const emojiOpen = useEmojiPicker((s) => s.open);
  const canUndo = useBoard((s) => s.canUndo);
  const canRedo = useBoard((s) => s.canRedo);
  const readOnly = useBoard((s) => s.readOnly);
  const { setTool, undo, redo } = useBoard.getState();
  // View only: just looking around (select and hand), no undo.
  const tools = readOnly ? TOOL_SHORTCUTS.filter(({ tool: t }) => t === 'select' || t === 'hand') : TOOL_SHORTCUTS;

  return (
    <div className="toolbar" data-ui onPointerDown={commitActiveEdit}>
      {readOnly && (
        <span className="toolbar__badge" title="You can look, follow and present, but not change this board">
          View only
        </span>
      )}
      {tools.map(({ tool: t, label, key }) => {
        // The pen button shows whichever pen mode is picked.
        const Icon = t === 'pen' ? Icons[penMode] : Icons[t];
        return (
          <button
            key={t}
            className={`icon-btn${tool === t ? ' icon-btn--active' : ''}`}
            title={tooltip(label, [key])}
            aria-label={label}
            aria-pressed={tool === t}
            onClick={() => setTool(t)}
          >
            {t === 'rect' && shapeKind !== 'rect' ? <ShapeIcon kind={shapeKind} size={20} /> : <Icon />}
          </button>
        );
      })}
      {!readOnly && (
        <>
          <button className="icon-btn" title={tooltip('Image', ['I'])} aria-label="Image" onClick={pickImageFiles}>
            <Icons.image />
          </button>
          <button
            className={`icon-btn${emojiOpen ? ' icon-btn--active' : ''}`}
            title={tooltip('Emoji', ['J'])}
            aria-label="Emoji"
            aria-pressed={emojiOpen}
            onClick={toggleEmojiPicker}
          >
            <Icons.emoji />
          </button>
          <button className="icon-btn" title={tooltip('Link card', ['K'])} aria-label="Link card" onClick={askForLink}>
            <Icons.link />
          </button>
        </>
      )}
      {!readOnly && (
        <>
          <div className="divider divider--h" />
          <button className="icon-btn" title={tooltip('Undo', ['Mod', 'Z'])} aria-label="Undo" disabled={!canUndo} onClick={undo}>
            <Icons.undo />
          </button>
          <button className="icon-btn" title={tooltip('Redo', ['Mod', 'Shift', 'Z'])} aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <Icons.redo />
          </button>
        </>
      )}
    </div>
  );
}
