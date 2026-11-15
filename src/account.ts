import { create } from 'zustand';
import { createAuthClient } from 'better-auth/client';
import { renameMe } from './collab/connection';

/**
 * Your niro account: sign up, sign in, sign out, change your name. The niro server
 * (server/auth.mjs, Better Auth) keeps accounts; the page reaches it on its own
 * address at /api/auth (the Vite dev server forwards it), and the session is an
 * httpOnly cookie the page never sees. Without the server niro works as before,
 * signed out.
 */
export const authClient = createAuthClient();

export interface Account {
  id: string;
  name: string;
  email: string;
}

export type AccountStatus = 'loading' | 'signed-out' | 'signed-in';

interface AccountState {
  status: AccountStatus;
  user: Account | null;
  /** The sign-in dialog: which form is open, or closed. */
  dialog: 'sign-in' | 'sign-up' | null;
}

export const useAccount = create<AccountState>(() => ({ status: 'loading', user: null, dialog: null }));

export const openAccountDialog = (dialog: AccountState['dialog']) => useAccount.setState({ dialog });

const UNREACHABLE = 'Can’t reach the niro server. Is it running (npm run server)?';

/** A readable message from a Better Auth error (or a failed request). */
function message(error: { message?: string; status?: number } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.status && error.status >= 500) return UNREACHABLE;
  return error.message || fallback;
}

function signedIn(user: { id: string; name: string; email: string }) {
  useAccount.setState({ status: 'signed-in', user: { id: user.id, name: user.name, email: user.email }, dialog: null });
  // Others on a board see your account name.
  renameMe(user.name);
}

/** Ask the server who is signed in (on start). Signed out when it can't be reached. */
export async function loadSession(): Promise<void> {
  try {
    const { data } = await authClient.getSession();
    if (data?.user) signedIn(data.user);
    else useAccount.setState({ status: 'signed-out', user: null });
  } catch {
    useAccount.setState({ status: 'signed-out', user: null });
  }
}

/** Create an account and sign in. Returns an error message, or null when it worked. */
export async function signUp(name: string, email: string, password: string): Promise<string | null> {
  try {
    const { data, error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    if (error || !data?.user) return message(error, 'Could not create the account.');
    signedIn(data.user);
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
    return null;
  } catch {
    return UNREACHABLE;
  }
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    useAccount.setState({ status: 'signed-out', user: null });
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
    } catch {
      return UNREACHABLE;
    }
  }
  renameMe(clean);
  return null;
}
