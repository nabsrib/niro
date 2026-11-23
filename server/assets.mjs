// Picture files for image items (src/assets.ts): POST, GET and HEAD /api/assets/<id>.
// Saved as server/data/assets/<id>.<ext>. Ids are 128 random bits chosen by the
// page, so only people who were shown the board (and so the id) can ask for a
// file; a signed-in session (an account or a guest) is still required.
// SVG is not accepted: it can carry scripts.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ID = /^[a-f0-9]{32}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const EXT_TYPE = Object.fromEntries(Object.entries(TYPES).map(([type, ext]) => [ext, type]));

export async function createAssets(dataDir) {
  const dir = join(dataDir, 'assets');
  await mkdir(dir, { recursive: true });

  /** The stored file for an id, if any: its path and content type. */
  async function find(id) {
    for (const [ext, type] of Object.entries(EXT_TYPE)) {
      const file = join(dir, `${id}.${ext}`);
      try {
        const info = await stat(file);
        return { file, type, size: info.size };
      } catch {
        // try the next extension
      }
    }
    return null;
  }

  async function readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BYTES) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Handle /api/assets/<id> for a signed-in session. Writes the response itself
   * (files are binary, not JSON); returns [status, error] when it failed.
   */
  async function handle(request, response, id) {
    if (!ID.test(id ?? '')) return [400, 'Bad image id.'];
    if (request.method === 'GET' || request.method === 'HEAD') {
      const found = await find(id);
      if (!found) return [404, 'No such image.'];
      response.writeHead(200, {
        'Content-Type': found.type,
        'Content-Length': found.size,
        // A file never changes for its id, so browsers may keep it.
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : await readFile(found.file));
      return null;
    }
    if (request.method === 'POST') {
      const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const ext = TYPES[type];
      if (!ext) return [415, 'Only PNG, JPEG, GIF and WebP images can be uploaded.'];
      if (await find(id)) {
        // Already here (uploaded from another tab or device): nothing to do.
        request.resume();
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
        return null;
      }
      const body = await readBody(request);
      if (!body) return [413, 'Images can be at most 10 MB.'];
      if (!body.length) return [400, 'Empty image.'];
      const file = join(dir, `${id}.${ext}`);
      await writeFile(`${file}.tmp`, body);
      await rename(`${file}.tmp`, file);
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
      return null;
    }
    return [405, 'Method not allowed.'];
  }

  return { handle };
}
