// niro server: live collaboration (board changes and presence between everyone on
// a board) plus a small web API (accounts, boards, sharing), on one port.
//
//   npm run server          (port 1234; set PORT to change it)
//
// - Live boards: Hocuspocus (https://tiptap.dev/docs/hocuspocus) does the Yjs syncing.
//   Each board is saved in server/data/<board id>.ydoc, 2 s after the last change.
//   Opening a board checks the sign-in cookie and the person's role on it; viewers
//   get a read-only connection.
// - Accounts: Better Auth under /api/auth/* (server/auth.mjs).
// - Boards and sharing: /api/boards... (server/boards.mjs).
// - Your settings (cursor / avatar color): /api/me (server/me.mjs).
// - Picture files of image items: /api/assets/<id> (server/assets.mjs), in server/data/assets/.
// - Page titles for link cards: /api/link-preview?url= (server/links.mjs, public addresses only).
// - Everything except board content is kept in server/data/niro.sqlite (Node's
//   built-in SQLite, Node 22.5+).
// - The app talks to all of it through the Vite dev server (vite.config.ts forwards
//   /api and /collab here), so the page and the server share one address.

import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { createAuth } from './auth.mjs';
import { HttpError, createBoards, readJson, setupBoardTables } from './boards.mjs';
import { createSettings } from './me.mjs';
import { createAssets } from './assets.mjs';
import { linkTitle } from './links.mjs';

const PORT = Number(process.env.PORT ?? 1234);
const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
/** Board ids are short letters and digits (uid() in src/geometry.ts); anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const safeId = (id) => typeof id === 'string' && SAFE_ID.test(id);

await mkdir(DATA, { recursive: true });

const db = new DatabaseSync(join(DATA, 'niro.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
// boards is set up below; a guest who makes an account takes their link-opened boards along.
const auth = await createAuth(db, DATA, { onGuestLinked: (guestId, userId) => boards.moveGuest(guestId, userId) });
const authHandler = toNodeHandler(auth);
setupBoardTables(db);
const settings = createSettings(db);
const assets = await createAssets(DATA);

/** Picture files (binary, so not through handleApi): signed in and same origin, like the rest of the API. */
async function handleAssets(request, response, id) {
  try {
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) return sendJson(response, 403, { error: 'Wrong origin.' });
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) return sendJson(response, 401, { error: 'Sign in first.' });
    const failed = await assets.handle(request, response, id);
    if (failed) sendJson(response, failed[0], { error: failed[1] });
  } catch (err) {
    console.error(err);
    if (!response.headersSent) sendJson(response, 500, { error: 'Something went wrong on the server.' });
  }
}

function boardFile(name) {
  if (!safeId(name)) throw new Error(`Refused board id "${name}"`);
  return join(DATA, `${name}.ydoc`);
}

const boards = createBoards(db, {
  boardFileOf: boardFile,
  removeFile: async (file) => {
    await unlink(file).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  },
  closeConnections: (id) => dropConnections(id),
});

/**
 * Access to a board changed (role, link access, guests, removal, deletion): close
 * everyone's whole socket to it. Their page reconnects by itself and is checked
 * again with the new access. (Hocuspocus's own closeConnections only closes the
 * board inside the socket, and the page then never signs in to it again.)
 */
function dropConnections(id) {
  const document = server.hocuspocus.documents.get(id);
  document?.connections.forEach((_clients, connection) => connection.webSocket.close(4000, 'Access changed'));
}

/** An error the page receives as the reason its live connection was refused. */
const deny = (reason) => Object.assign(new Error(reason), { reason });

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

/**
 * Our own API routes (signed-in only, same-origin only): /api/boards... and /api/me.
 * `route(method, parts, body, user)` returns [status, body]; parts follow /api/<name>/.
 */
async function handleApi(request, response, path, route) {
  try {
    // Requests must come from the page itself (another site can't use your cookie here).
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) throw new HttpError(403, 'Wrong origin.');
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new HttpError(401, 'Sign in first.');
    const parts = path.split('/').slice(3).filter(Boolean); // ['', 'api', '<name>', ...]
    const body = ['POST', 'PATCH'].includes(request.method) ? await readJson(request) : {};
    const [status, result] = await route(request.method, parts, body, session.user);
    sendJson(response, status, result);
  } catch (err) {
    if (err instanceof HttpError) sendJson(response, err.status, { error: err.message });
    else {
      console.error(err);
      sendJson(response, 500, { error: 'Something went wrong on the server.' });
    }
  }
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
    if (path === '/api/boards' || path.startsWith('/api/boards/')) {
      await handleApi(request, response, path, (method, parts, body, user) => boards.handle(method, parts, body, user, safeId));
      throw null;
    }
    if (path === '/api/me') {
      await handleApi(request, response, path, (method, _parts, body, user) => settings.handle(method, body, user));
      throw null;
    }
    if (path === '/api/link-preview') {
      const target = new URL(request.url ?? '/', 'http://local').searchParams.get('url') ?? '';
      await handleApi(request, response, path, async (method) => {
        if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
        // A page that can't be read (or isn't allowed) just has no title.
        const title = await linkTitle(target).catch(() => null);
        return [200, { title }];
      });
      throw null;
    }
    if (path.startsWith('/api/assets/')) {
      await handleAssets(request, response, path.split('/')[3]);
      throw null;
    }
    if (path.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Not found' });
      throw null;
    }
  },

  // Opening a board live: signed in, and allowed on that board. Viewers are read-only.
  async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) throw deny('signed-out');
    const { role, reason } = boards.access(documentName, session.user);
    if (!role) throw deny(reason);
    if (role === 'viewer') connectionConfig.readOnly = true;
    return { userId: session.user.id, role };
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
    boards.touch(documentName);
  },
});

await server.listen();
console.log(`niro server: port ${PORT} · data in ${DATA}`);
