// Your own settings that Better Auth doesn't keep: for now the color of your cursor
// and avatar, so it is the same on every device. GET / PATCH /api/me.

import { HttpError } from './boards.mjs';

const COLOR = /^#[0-9a-f]{6}$/i;

export function createSettings(db) {
  db.exec('CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, color TEXT)');
  const get = db.prepare('SELECT color FROM user_settings WHERE user_id = ?');
  const set = db.prepare(
    'INSERT INTO user_settings (user_id, color) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET color = excluded.color',
  );

  /** Handle /api/me for a signed-in user. Returns [status, body]. */
  function handle(method, body, user) {
    if (method === 'GET') return [200, { color: get.get(user.id)?.color ?? null }];
    if (method === 'PATCH') {
      if (!COLOR.test(body.color ?? '')) throw new HttpError(400, 'Pick a color like #4262ff.');
      set.run(user.id, body.color.toLowerCase());
      return [200, { color: body.color.toLowerCase() }];
    }
    throw new HttpError(405, 'Method not allowed.');
  }

  return { handle };
}
