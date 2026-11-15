// niro server: live collaboration (board changes and presence between everyone on
// a board) plus a small web API (accounts), on one port.
//
//   npm run server          (port 1234; set PORT to change it)
//
// - Live boards: Hocuspocus (https://tiptap.dev/docs/hocuspocus) does the Yjs syncing.
//   Each board is saved in server/data/<board id>.ydoc, 2 s after the last change.
// - Accounts: Better Auth under /api/auth/* (server/auth.mjs), stored with the rest of
//   the server's data in server/data/niro.sqlite (Node's built-in SQLite, Node 22.5+).
// - The app talks to both through the Vite dev server (vite.config.ts forwards /api
//   and /collab here), so the page and the server share one address and cookies work.
// Boards are not protected by accounts yet (part 9c): keep the server on your own network.

import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNodeHandler } from 'better-auth/node';
import { createAuth } from './auth.mjs';

const PORT = Number(process.env.PORT ?? 1234);
const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
/** Board ids are short letters and digits (uid() in src/geometry.ts); anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

await mkdir(DATA, { recursive: true });

const db = new DatabaseSync(join(DATA, 'niro.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
const auth = await createAuth(db, DATA);
const authHandler = toNodeHandler(auth);

function boardFile(name) {
  if (!SAFE_ID.test(name)) throw new Error(`Refused board id "${name}"`);
  return join(DATA, `${name}.ydoc`);
}

const server = new Server({
  port: PORT,

  // Plain web requests (not the live connection): the API.
  async onRequest({ request, response }) {
    const path = (request.url ?? '/').split('?')[0];
    if (path.startsWith('/api/auth/')) {
      await authHandler(request, response);
      throw null; // handled: stop Hocuspocus from answering too
    }
    if (path.startsWith('/api/')) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      throw null;
    }
  },

  async onLoadDocument({ documentName, document }) {
    try {
      Y.applyUpdate(document, await readFile(boardFile(documentName)));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // a board nobody has saved yet starts empty
    }
  },

  async onStoreDocument({ documentName, document }) {
    // Write a temporary file first, so a crash mid-write never leaves half a board.
    const file = boardFile(documentName);
    await writeFile(`${file}.tmp`, Y.encodeStateAsUpdate(document));
    await rename(`${file}.tmp`, file);
  },
});

await server.listen();
console.log(`niro server: port ${PORT} · data in ${DATA}`);
