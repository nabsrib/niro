/**
 * Who you are on shared boards, until accounts exist: a name and a color, picked
 * at random the first time and remembered in this browser (localStorage).
 */
export interface LocalUser {
  name: string;
  color: string;
}

const KEY = 'niro:user';

/** Cursor and avatar colors: saturated enough to read on the grey board. */
export const USER_COLORS = ['#e8416f', '#f28b1c', '#d9a400', '#2fa84f', '#14a3b8', '#4262ff', '#8a4dff', '#d23fc4'];

const ADJECTIVES = ['Blue', 'Bright', 'Calm', 'Clever', 'Swift', 'Happy', 'Bold', 'Quiet', 'Sunny', 'Lucky'];
const ANIMALS = ['Fox', 'Owl', 'Otter', 'Panda', 'Tiger', 'Koala', 'Falcon', 'Lynx', 'Dolphin', 'Badger'];

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function save(user: LocalUser) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    // Storage blocked: the name lasts until the page closes.
  }
}

let user: LocalUser | null = null;

export function getUser(): LocalUser {
  if (user) return user;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LocalUser | null;
    if (saved && typeof saved.name === 'string' && typeof saved.color === 'string') user = saved;
  } catch {
    // Unreadable: make a new one.
  }
  if (!user) {
    user = { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(USER_COLORS) };
    save(user);
  }
  return user;
}

export function setUser(patch: Partial<LocalUser>): LocalUser {
  user = { ...getUser(), ...patch };
  save(user);
  return user;
}

/** Up to two initials for an avatar ("Swift Otter" → "SO"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}
