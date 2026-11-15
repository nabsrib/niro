import type { LinkAccess, Role } from './types';

/**
 * The niro server's boards API (server/boards.mjs), on the page's own address
 * (/api, forwarded by the Vite dev server). Requests carry the sign-in cookie.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A board as the server lists it. */
export interface ServerBoard {
  id: string;
  name: string;
  role: Role;
  ownerName: string;
  linkAccess: LinkAccess;
  createdAt: number;
  updatedAt: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Call the API. Throws ApiError with a readable message (status 0 = server unreachable). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the niro server. Is it running (npm run server)?');
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    const unreachable = res.status >= 502 && res.status <= 504;
    throw new ApiError(
      unreachable ? 0 : res.status,
      unreachable ? 'Can’t reach the niro server. Is it running (npm run server)?' : (data?.error ?? `Request failed (${res.status}).`),
    );
  }
  return data as T;
}

export const boardsApi = {
  list: () => api<ServerBoard[]>('GET', '/boards'),
  get: (id: string) => api<ServerBoard>('GET', `/boards/${id}`),
  create: (id: string, name: string) => api<ServerBoard>('POST', '/boards', { id, name }),
  update: (id: string, patch: { name?: string; linkAccess?: LinkAccess }) => api<ServerBoard>('PATCH', `/boards/${id}`, patch),
  remove: (id: string) => api<{ deleted: boolean }>('DELETE', `/boards/${id}`),
  members: (id: string) => api<Member[]>('GET', `/boards/${id}/members`),
  invite: (id: string, email: string, role: Role) => api<Member>('POST', `/boards/${id}/members`, { email, role }),
  setRole: (id: string, userId: string, role: Role) => api<{ ok: true }>('PATCH', `/boards/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => api<{ ok: true }>('DELETE', `/boards/${id}/members/${userId}`),
};
