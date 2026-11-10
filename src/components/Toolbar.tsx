import { useBoard } from '../store';
import type { Tool } from '../types';
import { Icons } from './Icons';

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'hand', label: 'Hand', key: 'H' },
  { tool: 'sticky', label: 'Sticky note', key: 'N' },
  { tool: 'text', label: 'Text', key: 'T' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O' },
];

export function Toolbar() {
  const tool = useBoard((s) => s.tool);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  const { setTool, undo, redo } = useBoard.getState();

  return (
    <div className="toolbar" data-ui>
      {TOOLS.map(({ tool: t, label, key }) => {
        const Icon = Icons[t];
        return (
          <button
            key={t}
            className={`icon-btn${tool === t ? ' icon-btn--active' : ''}`}
            title={`${label}  ${key}`}
            aria-label={label}
            aria-pressed={tool === t}
            onClick={() => setTool(t)}
          >
            <Icon />
          </button>
        );
      })}
      <div className="divider divider--h" />
      <button className="icon-btn" title="Undo  Ctrl+Z" aria-label="Undo" disabled={!canUndo} onClick={undo}>
        <Icons.undo />
      </button>
      <button className="icon-btn" title="Redo  Ctrl+Shift+Z" aria-label="Redo" disabled={!canRedo} onClick={redo}>
        <Icons.redo />
      </button>
    </div>
  );
}
