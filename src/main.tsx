import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initBoards } from './boards';
import { useBoard } from './store';
import './styles.css';

// Dev only: `niroStress(5000)` in the console fills the board to test performance.
if (import.meta.env.DEV) {
  void import('./devStress').then((m) => {
    (window as unknown as { niroStress: typeof m.stress }).niroStress = m.stress;
  });
}

// Load the boards (from IndexedDB) before the first render; index.html shows
// "Loading board…" meanwhile.
const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
initBoards().then(render, (err: unknown) => {
  render();
  useBoard.getState().showNotice(`Could not load your boards: ${(err as Error).message}`, 'error');
});
