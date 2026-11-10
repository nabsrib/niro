import { Canvas } from './components/Canvas';
import { BoardMenu } from './components/BoardMenu';
import { Notice } from './components/Notice';
import { PenOptions } from './components/PenOptions';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export default function App() {
  useKeyboardShortcuts();
  return (
    <div className="app">
      <Canvas />
      <BoardMenu />
      <Toolbar />
      <PenOptions />
      <div className="corner-controls">
        <ZoomControls />
        <ShortcutsHelp />
      </div>
      <Notice />
      <div className="hint">
        Scroll to pan · Ctrl + scroll to zoom · Space + drag to pan · Double-click to edit · Press ? for all shortcuts
      </div>
    </div>
  );
}
