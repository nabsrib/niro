import { Canvas } from './components/Canvas';
import { BoardMenu } from './components/BoardMenu';
import { Notice } from './components/Notice';
import { PenOptions } from './components/PenOptions';
import { FrameOptions } from './components/FrameOptions';
import { PresentButton, Presenter } from './components/Presenter';
import { FocusMode } from './components/FocusMode';
import { DevStats } from './components/DevStats';
import { ExportDialog } from './components/ExportDialog';
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
          <FocusMode />
          <BoardMenu />
          <Toolbar />
          <PenOptions />
          <FrameOptions />
          <div className="top-right">
            <PresentButton />
          </div>
          <div className="corner-controls">
            <ZoomControls />
            <ShortcutsHelp />
          </div>
          {import.meta.env.DEV && <DevStats />}
          <div className="hint">
            Scroll or right-drag to pan · Ctrl + scroll to zoom · Double-click to edit text · Press ? for all shortcuts
          </div>
        </>
      )}
      <ExportDialog />
      <Notice />
    </div>
  );
}
