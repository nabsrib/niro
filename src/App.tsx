import { Canvas } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export default function App() {
  useKeyboardShortcuts();
  return (
    <div className="app">
      <Canvas />
      <div className="brand" data-ui>
        niro
      </div>
      <Toolbar />
      <ZoomControls />
      <div className="hint">
        Scroll to pan · Ctrl + scroll to zoom · Space + drag to pan · Double-click to edit · Alt + drag to skip snapping
      </div>
    </div>
  );
}
