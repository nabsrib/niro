import { useBoard } from '../store';
import { Icons } from './Icons';
import { commitActiveEdit } from '../editing';
import { TOOL_SHORTCUTS, tooltip } from '../shortcuts';

export function Toolbar() {
  const tool = useBoard((s) => s.tool);
  const penMode = useBoard((s) => s.penMode);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  const { setTool, undo, redo } = useBoard.getState();

  return (
    <div className="toolbar" data-ui onPointerDown={commitActiveEdit}>
      {TOOL_SHORTCUTS.map(({ tool: t, label, key }) => {
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
            <Icon />
          </button>
        );
      })}
      <div className="divider divider--h" />
      <button className="icon-btn" title={tooltip('Undo', ['Mod', 'Z'])} aria-label="Undo" disabled={!canUndo} onClick={undo}>
        <Icons.undo />
      </button>
      <button className="icon-btn" title={tooltip('Redo', ['Mod', 'Shift', 'Z'])} aria-label="Redo" disabled={!canRedo} onClick={redo}>
        <Icons.redo />
      </button>
    </div>
  );
}
