import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Dev only: `niroStress(5000)` in the console fills the board to test performance.
if (import.meta.env.DEV) {
  void import('./devStress').then((m) => {
    (window as unknown as { niroStress: typeof m.stress }).niroStress = m.stress;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
