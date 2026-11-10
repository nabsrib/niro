import { Canvas } from './components/Canvas';
import { BoardMenu } from './components/BoardMenu';
import { Notice } from './components/Notice';
import { PenOptions } from './components/PenOptions';
import { PresentButton, Presenter } from './components/Presenter';
import { useBoard } from './store';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export default function App() {
  useKeyboardShortcuts();
  // Presenting hides all editing chrome; only the slides and their controls show.
  const presenting = useBoard((s) => s.presenting !== null);
  return (
    <div className="app">
      <Canvas />
      {presenting ? (
        <Presenter />
      ) : (
        <>
          <BoardMenu />
          <Toolbar />
          <PenOptions />
          <PresentButton />
          <div className="corner-controls">
            <ZoomControls />
            <ShortcutsHelp />
          </div>
          <div className="hint">
            Scroll to pan · Ctrl + scroll to zoom · Space + drag to pan · Double-click to edit · Press ? for all shortcuts
          </div>
        </>
      )}
      <Notice />
    </div>
  );
}
