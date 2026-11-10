import { Canvas } from './components/Canvas';
import { BoardMenu } from './components/BoardMenu';
import { Notice } from './components/Notice';
import { PenOptions } from './components/PenOptions';
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
      <ZoomControls />
      <Notice />
      <div className="hint">
        Scroll to pan · Ctrl + scroll to zoom · Space + drag to pan · Double-click to edit · Alt + drag to skip snapping
      </div>
    </div>
  );
}
