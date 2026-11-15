// Accounts: sign-up, sign-in and sessions, done by Better Auth (https://better-auth.com).
// Passwords are hashed by the library (never stored as typed), sessions live in an
// httpOnly cookie, and repeated attempts are rate limited. Its tables (user, session,
// account, verification) are created in the SQLite database on start.

import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

/**
 * Hosts the app may be opened on: this computer, and private network addresses
 * (so phones and laptops at home can sign in). Add more with NIRO_HOSTS, e.g.
 * NIRO_HOSTS=my-pc.local:*,niro.example.com
 */
const HOSTS = [
  'localhost:*',
  '127.0.0.1:*',
  '192.168.*.*:*',
  '10.*.*.*:*',
  '172.*.*.*:*',
  ...(process.env.NIRO_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
];

/** The signing secret: BETTER_AUTH_SECRET, else one made on first start and kept in the data folder. */
async function loadSecret(dataDir) {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const file = join(dataDir, 'auth-secret.txt');
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const secret = randomBytes(32).toString('base64');
    await writeFile(file, secret, { mode: 0o600 });
    return secret;
  }
}

/** Set up Better Auth on the database and create its tables if needed. */
export async function createAuth(db, dataDir) {
  const auth = betterAuth({
    appName: 'niro',
    database: db,
    secret: await loadSecret(dataDir),
    // The page reaches the API through the Vite dev server, so the Host header is
    // the page's host; only the hosts above are accepted (and trusted as origins).
    baseURL: { allowedHosts: HOSTS, protocol: 'http' },
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8 },
    rateLimit: { enabled: true },
    telemetry: { enabled: false },
  });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  return auth;
}
