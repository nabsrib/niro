import { create } from 'zustand';
import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { recolorMe, renameMe, usePresence } from './collab/connection';
import { meApi } from './api';

/**
 * Your niro account: sign up, sign in, sign out, change your name. The niro server
 * (server/auth.mjs, Better Auth) keeps accounts; the page reaches it on its own
 * address at /api/auth (the Vite dev server forwards it), and the session is an
 * httpOnly cookie the page never sees. A browser has one sign-in for all its tabs,
 * so tabs tell each other when it changes (BroadcastChannel `niro:account`).
 * Without the server niro works as before.
 *
 * Guests: "Continue as guest" signs in without email or password (Better Auth's
 * anonymous plugin). Guests can open boards whose owner lets guests use the
 * link, but keep no boards on the server; creating an account (or signing in)
 * later turns the guest session into that account.
 */
export const authClient = createAuthClient({ plugins: [anonymousClient()] });

export interface Account {
  id: string;
  name: string;
  email: string;
  /** Signed in as a guest (no account). */
  guest: boolean;
}

/**
 * `offline`: the server couldn't be reached, so it's unknown who is signed in;
 * boards already in this browser keep working and nothing is signed out.
 */
export type AccountStatus = 'loading' | 'signed-out' | 'signed-in' | 'offline';

interface AccountState {
  status: AccountStatus;
  user: Account | null;
  /** The account dialog: sign in, create account, continue as guest, or your settings; or closed. */
  dialog: 'sign-in' | 'sign-up' | 'guest' | 'settings' | null;
}

export const useAccount = create<AccountState>(() => ({ status: 'loading', user: null, dialog: null }));

export const openAccountDialog = (dialog: AccountState['dialog']) => useAccount.setState({ dialog });

export const UNREACHABLE = 'Can’t reach the niro server. Is it running (npm run server)?';

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('niro:account');
/** Tell the other tabs the sign-in changed; they ask the server again. */
const announce = () => channel?.postMessage('changed');
if (channel) channel.onmessage = () => void loadSession();

/** A readable message from a Better Auth error (or a failed request). */
function message(error: { message?: string; status?: number } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.status && error.status >= 500) return UNREACHABLE;
  return error.message || fallback;
}

/** Name others see: guests get "(guest)" after theirs. */
const shownName = (a: Account) => (a.guest ? `${a.name} (guest)` : a.name);

function signedIn(user: { id: string; name: string; email: string; isAnonymous?: boolean | null }) {
  const { dialog } = useAccount.getState();
  const account: Account = { id: user.id, name: user.name, email: user.email, guest: !!user.isAnonymous };
  useAccount.setState({ status: 'signed-in', user: account, dialog: dialog === 'settings' ? dialog : null });
  // Others on a board see your account name, and your account's color.
  renameMe(shownName(account));
  void syncColor();
}

/**
 * Continue as a guest under `name` (no email or password). Returns an error
 * message, or null when it worked.
 */
export async function signInAsGuest(name: string): Promise<string | null> {
  try {
    const { data, error } = await authClient.signIn.anonymous();
    if (error || !data?.user) return message(error, 'Could not start a guest session.');
    const clean = name.trim().slice(0, 40) || 'Guest';
    await authClient.updateUser({ name: clean });
    signedIn({ ...data.user, name: clean, isAnonymous: true });
    announce();
    return null;
  } catch {
    return UNREACHABLE;
  }
}

/**
 * Use the color kept with your account. An account without one yet takes this
 * browser's color, so it stays the same everywhere from now on.
 */
async function syncColor() {
  try {
    const { color } = await meApi.get();
    if (color) recolorMe(color);
    else await meApi.setColor(usePresence.getState().me.color);
  } catch {
    // Server unreachable: keep this browser's color.
  }
}

/** Ask the server who is signed in (on start, and when another tab signs in or out). */
export async function loadSession(): Promise<void> {
  try {
    const { data, error } = await authClient.getSession();
    if (error && (!error.status || error.status >= 500)) return void useAccount.setState({ status: 'offline' });
    if (data?.user) signedIn(data.user);
    else useAccount.setState({ status: 'signed-out', user: null });
  } catch {
    useAccount.setState({ status: 'offline' });
  }
}

/** Create an account and sign in. Returns an error message, or null when it worked. */
export async function signUp(name: string, email: string, password: string): Promise<string | null> {
  try {
    const { data, error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    if (error || !data?.user) return message(error, 'Could not create the account.');
    signedIn(data.user);
    announce();
    return null;
  } catch {
    return UNREACHABLE;
  }
}

/** Sign in. Returns an error message, or null when it worked. */
export async function signIn(email: string, password: string): Promise<string | null> {
  try {
    const { data, error } = await authClient.signIn.email({ email: email.trim(), password });
    if (error || !data?.user) return message(error, 'Wrong email or password.');
    signedIn(data.user);
    announce();
    return null;
  } catch {
    return UNREACHABLE;
  }
}

/** Sign out. A guest's session is ended for good (the guest user is deleted). */
export async function signOut(): Promise<void> {
  try {
    if (useAccount.getState().user?.guest) await authClient.deleteAnonymousUser().catch(() => undefined);
    await authClient.signOut();
  } finally {
    useAccount.setState({ status: 'signed-out', user: null });
    announce();
  }
}

/** Change your color: on the account when signed in, and as others see you. Returns an error message or null. */
export async function changeColor(color: string): Promise<string | null> {
  if (useAccount.getState().user) {
    try {
      await meApi.setColor(color);
      announce();
    } catch (err) {
      return (err as Error).message;
    }
  }
  recolorMe(color);
  return null;
}

/**
 * Change your password (needs the current one). Signs you out on your other
 * devices. Returns an error message, or null when it worked.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<string | null> {
  try {
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    return error ? message(error, 'Could not change your password.') : null;
  } catch {
    return UNREACHABLE;
  }
}

/** Change your name: on the account when signed in, and as others see you. Returns an error message or null. */
export async function changeName(name: string): Promise<string | null> {
  const clean = name.trim().slice(0, 40);
  if (!clean) return null;
  const { user } = useAccount.getState();
  if (user) {
    try {
      const { error } = await authClient.updateUser({ name: clean });
      if (error) return message(error, 'Could not change your name.');
      useAccount.setState({ user: { ...user, name: clean } });
      announce();
    } catch {
      return UNREACHABLE;
    }
  }
  renameMe(user ? shownName({ ...user, name: clean }) : clean);
  return null;
}
