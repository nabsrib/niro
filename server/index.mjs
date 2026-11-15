// niro collaboration server: passes board changes and presence (cursors, names)
// between everyone who has the same board open, and saves each board to a file.
//
//   npm run server          (port 1234; set PORT to change it)
//
// Hocuspocus (https://tiptap.dev/docs/hocuspocus) does the Yjs syncing. Boards are
// saved in server/data/<board id>.ydoc as one Yjs update, 2 s after the last change.
// No accounts yet: anyone who can reach this port can open and edit any board whose
// id they know, so keep it on your computer or home network.

import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 1234);
const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
/** Board ids are short letters and digits (uid() in src/geometry.ts); anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

await mkdir(DATA, { recursive: true });

function boardFile(name) {
  if (!SAFE_ID.test(name)) throw new Error(`Refused board id "${name}"`);
  return join(DATA, `${name}.ydoc`);
}

const server = new Server({
  port: PORT,

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
console.log(`niro server: ws://localhost:${PORT} · boards saved in ${DATA}`);
