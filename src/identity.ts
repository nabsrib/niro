import { useAccount } from './account';

/**
 * Who "I" am for things that remember a person (a hidden frame, a comment's
 * author): the account id when signed in, else an id kept in this browser.
 */
const KEY = 'niro:browser-id';
let browserId: string | null = null;

function localId(): string {
  if (browserId) return browserId;
  try {
    browserId = localStorage.getItem(KEY);
  } catch {
    // storage blocked: an id for this page only
  }
  if (!browserId) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    browserId = `b-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    try {
      localStorage.setItem(KEY, browserId);
    } catch {
      // keep it in memory
    }
  }
  return browserId;
}

export function myIdentity(): string {
  return useAccount.getState().user?.id ?? localId();
}

/** React hook form, so screens update when you sign in or out. */
export function useMyIdentity(): string {
  const userId = useAccount((s) => s.user?.id);
  return userId ?? localId();
}
