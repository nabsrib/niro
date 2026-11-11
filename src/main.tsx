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

/**
 * The animated loading screen (in index.html) stays until the boards have
 * loaded and for at least this long after the page opened, so it never just
 * flashes; then it fades into the board.
 */
const MIN_SPLASH_MS = 800;
const SPLASH_FADE_MS = 350;

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const wait = Math.max(0, MIN_SPLASH_MS - performance.now());
  window.setTimeout(() => {
    splash.classList.add('splash--hide');
    window.setTimeout(() => splash.remove(), SPLASH_FADE_MS + 50);
  }, wait);
}

// Load the boards (from IndexedDB) before the first render; the app renders
// under the loading screen, which then fades out.
const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
initBoards().then(
  () => {
    render();
    hideSplash();
  },
  (err: unknown) => {
    render();
    hideSplash();
    useBoard.getState().showNotice(`Could not load your boards: ${(err as Error).message}`, 'error');
  },
);
