import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The niro server (`npm run server`, port 1234) is reached through this dev server,
 * so the page and the server share one address: sign-in cookies just work, and
 * other devices only need the "Network" address. `/api` = accounts and boards,
 * `/collab` = the live board connection (WebSocket).
 */
const SERVER = 'http://localhost:1234';
const proxy = {
  '/api': { target: SERVER },
  '/collab': { target: SERVER, ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
});
