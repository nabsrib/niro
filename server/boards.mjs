// Boards on the server: who owns each board, who else may open it (members with a
// role, or anyone with the link), and the web API the app uses to list, create,
// rename, delete and share boards. Board content itself stays in the .ydoc files.
//
// Roles: owner (one per board, can do everything), editor (edit and rename),
// viewer (look only: the live connection is read-only). Link access: 'none'
// (only the owner and members), 'view' or 'edit' (any signed-in person with the link).
// Guests (signed in without an account, `isAnonymous`) only get link access, and
// only on boards whose owner turned on `guest_access`; they can't own boards, be
// invited, or see members' emails.

const ROLES = new Set(['editor', 'viewer']);
const LINK_ACCESS = new Set(['none', 'view', 'edit']);
const MAX_BODY = 64 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function setupBoardTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS board (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      link_access TEXT NOT NULL DEFAULT 'none',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS board_member (
      board_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, user_id)
    );
    -- Boards someone opened through a link, so they show in that person's list.
    CREATE TABLE IF NOT EXISTS board_recent (
      board_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, user_id)
    );
  `);
  // Added with guest access (older databases get the column).
  const columns = db.prepare('PRAGMA table_info(board)').all().map((c) => c.name);
  if (!columns.includes('guest_access')) db.exec('ALTER TABLE board ADD COLUMN guest_access INTEGER NOT NULL DEFAULT 0');
}

const isGuest = (user) => !!user.isAnonymous;

/**
 * Board access for the web API and the live connection. `boardFileOf(id)` gives
 * a board's .ydoc path; `closeConnections(id)` drops everyone's live connection to
 * a board (they reconnect and are checked again, e.g. after a role change).
 */
export function createBoards(db, { boardFileOf, removeFile, closeConnections }) {
  const q = {
    board: db.prepare('SELECT * FROM board WHERE id = ?'),
    member: db.prepare('SELECT role FROM board_member WHERE board_id = ? AND user_id = ?'),
    insert: db.prepare('INSERT INTO board (id, name, owner_id, link_access, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    rename: db.prepare('UPDATE board SET name = ?, updated_at = ? WHERE id = ?'),
    link: db.prepare('UPDATE board SET link_access = ?, updated_at = ? WHERE id = ?'),
    guests: db.prepare('UPDATE board SET guest_access = ?, updated_at = ? WHERE id = ?'),
    moveRecents: db.prepare(
      'INSERT OR IGNORE INTO board_recent (board_id, user_id, opened_at) SELECT board_id, ?, opened_at FROM board_recent WHERE user_id = ?',
    ),
    dropRecents: db.prepare('DELETE FROM board_recent WHERE user_id = ?'),
    touch: db.prepare('UPDATE board SET updated_at = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM board WHERE id = ?'),
    delMembers: db.prepare('DELETE FROM board_member WHERE board_id = ?'),
    delRecents: db.prepare('DELETE FROM board_recent WHERE board_id = ?'),
    recent: db.prepare(
      'INSERT INTO board_recent (board_id, user_id, opened_at) VALUES (?, ?, ?) ON CONFLICT (board_id, user_id) DO UPDATE SET opened_at = excluded.opened_at',
    ),
    leave: db.prepare('DELETE FROM board_member WHERE board_id = ? AND user_id = ?'),
    leaveRecent: db.prepare('DELETE FROM board_recent WHERE board_id = ? AND user_id = ?'),
    setMember: db.prepare(
      'INSERT INTO board_member (board_id, user_id, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role',
    ),
    userByEmail: db.prepare('SELECT id, name, email FROM "user" WHERE lower(email) = lower(?) AND NOT coalesce("isAnonymous", 0)'),
    userById: db.prepare('SELECT id, name, email FROM "user" WHERE id = ?'),
    members: db.prepare(
      'SELECT m.user_id AS id, m.role, u.name, u.email FROM board_member m JOIN "user" u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY m.added_at',
    ),
    list: db.prepare(`
      SELECT b.*, u.name AS owner_name FROM board b JOIN "user" u ON u.id = b.owner_id
      WHERE b.owner_id = ?1
         OR b.id IN (SELECT board_id FROM board_member WHERE user_id = ?1)
         OR (b.link_access != 'none' AND b.id IN (SELECT board_id FROM board_recent WHERE user_id = ?1))
      ORDER BY b.created_at
    `),
  };

  /**
   * This person's role on a board: 'owner' | 'editor' | 'viewer', or null (no access
   * / no board). `user`: { id, isAnonymous }.
   */
  function roleFor(board, user) {
    if (!board) return null;
    if (board.owner_id === user.id) return 'owner';
    const m = q.member.get(board.id, user.id);
    if (m) return m.role;
    if (isGuest(user) && !board.guest_access) return null;
    return board.link_access === 'edit' ? 'editor' : board.link_access === 'view' ? 'viewer' : null;
  }

  /** Whether the role comes only from link access (then the board goes into their list as "recent"). */
  const viaLink = (board, user) => board.owner_id !== user.id && !q.member.get(board.id, user.id);

  const view = (board, user) => {
    const owner = q.userById.get(board.owner_id);
    return {
      id: board.id,
      name: board.name,
      role: roleFor(board, user),
      ownerName: owner?.name ?? '',
      linkAccess: board.link_access,
      guestAccess: !!board.guest_access,
      createdAt: board.created_at,
      updatedAt: board.updated_at,
    };
  };

  /** Check for the live connection: the role, or an error reason for the page. */
  function access(boardId, user) {
    const board = q.board.get(boardId);
    if (!board) return { reason: 'not-found' };
    const role = roleFor(board, user);
    if (!role) return { reason: isGuest(user) ? 'guest-no-access' : 'no-access' };
    if (viaLink(board, user)) q.recent.run(boardId, user.id, Date.now());
    return { role };
  }

  /** A guest made an account (or signed in): their link-opened boards go with them. */
  function moveGuest(guestId, userId) {
    q.moveRecents.run(userId, guestId);
    q.dropRecents.run(guestId);
  }

  const needBoard = (id) => {
    const board = q.board.get(id);
    if (!board) throw new HttpError(404, 'That board doesn’t exist (it may have been deleted).');
    return board;
  };
  const needRole = (board, user, allowed) => {
    const role = roleFor(board, user);
    if (!role && isGuest(user)) throw new HttpError(403, 'That board doesn’t let guests in. Create an account or sign in to open it.');
    if (!role) throw new HttpError(403, 'You don’t have access to that board. Ask its owner to share it with you.');
    if (!allowed.includes(role)) throw new HttpError(403, 'Only the board’s owner can do that.');
    return role;
  };
  const cleanName = (name) => {
    const n = typeof name === 'string' ? name.trim().slice(0, 100) : '';
    if (!n) throw new HttpError(400, 'A board needs a name.');
    return n;
  };

  /** Handle /api/boards... for a signed-in user. Returns [status, body]. */
  async function handle(method, parts, body, user, safeId) {
    const now = Date.now();
    const [id, sub, memberId] = parts;

    if (!id) {
      if (method === 'GET') return [200, q.list.all(user.id).map((b) => view(b, user)).filter((b) => b.role)];
      if (method === 'POST') {
        // Create a board (also used to move a board from this device into the account,
        // keeping its id; a board file nobody owns yet is taken over by its first owner).
        if (isGuest(user)) throw new HttpError(403, 'Guests can’t keep boards on the server. Create an account to do that.');
        if (!safeId(body.id)) throw new HttpError(400, 'Bad board id.');
        const name = cleanName(body.name);
        const existing = q.board.get(body.id);
        if (existing) {
          if (existing.owner_id !== user.id) throw new HttpError(409, 'A board with that id belongs to someone else.');
          return [200, view(existing, user)];
        }
        q.insert.run(body.id, name, user.id, 'none', now, now);
        return [201, view(q.board.get(body.id), user)];
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (!safeId(id)) throw new HttpError(400, 'Bad board id.');
    const board = needBoard(id);

    if (!sub) {
      if (method === 'GET') {
        needRole(board, user, ['owner', 'editor', 'viewer']);
        if (viaLink(board, user)) q.recent.run(id, user.id, now);
        return [200, view(board, user)];
      }
      if (method === 'PATCH') {
        if (body.name !== undefined) {
          needRole(board, user, ['owner', 'editor']);
          q.rename.run(cleanName(body.name), now, id);
        }
        if (body.linkAccess !== undefined) {
          needRole(board, user, ['owner']);
          if (!LINK_ACCESS.has(body.linkAccess)) throw new HttpError(400, 'Unknown link access.');
          q.link.run(body.linkAccess, now, id);
          closeConnections(id); // everyone reconnects with their new role
        }
        if (body.guestAccess !== undefined) {
          needRole(board, user, ['owner']);
          q.guests.run(body.guestAccess ? 1 : 0, now, id);
          closeConnections(id);
        }
        return [200, view(q.board.get(id), user)];
      }
      if (method === 'DELETE') {
        const role = needRole(board, user, ['owner', 'editor', 'viewer']);
        if (role !== 'owner') {
          // Not the owner: just take it out of this person's list.
          q.leave.run(id, user.id);
          q.leaveRecent.run(id, user.id);
          closeConnections(id);
          return [200, { deleted: false }];
        }
        q.del.run(id);
        q.delMembers.run(id);
        q.delRecents.run(id);
        closeConnections(id);
        await removeFile(boardFileOf(id));
        return [200, { deleted: true }];
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (sub !== 'members') throw new HttpError(404, 'Not found.');

    if (!memberId) {
      if (method === 'GET') {
        needRole(board, user, ['owner', 'editor', 'viewer']);
        const owner = q.userById.get(board.owner_id);
        const list = [{ id: owner?.id ?? board.owner_id, name: owner?.name ?? '', email: owner?.email ?? '', role: 'owner' }, ...q.members.all(id)];
        // Guests see names only, never people's emails.
        return [200, isGuest(user) ? list.map((m) => ({ ...m, email: '' })) : list];
      }
      if (method === 'POST') {
        needRole(board, user, ['owner']);
        if (!ROLES.has(body.role)) throw new HttpError(400, 'Pick editor or viewer.');
        const invited = typeof body.email === 'string' ? q.userByEmail.get(body.email.trim()) : undefined;
        if (!invited) throw new HttpError(404, 'No niro account uses that email. Ask them to create one first.');
        if (invited.id === board.owner_id) throw new HttpError(400, 'That’s the board’s owner.');
        q.setMember.run(id, invited.id, body.role, now);
        closeConnections(id);
        return [201, { id: invited.id, name: invited.name, email: invited.email, role: body.role }];
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (method === 'PATCH') {
      needRole(board, user, ['owner']);
      if (!ROLES.has(body.role)) throw new HttpError(400, 'Pick editor or viewer.');
      if (!q.member.get(id, memberId)) throw new HttpError(404, 'Not a member of this board.');
      q.setMember.run(id, memberId, body.role, now);
      closeConnections(id);
      return [200, { ok: true }];
    }
    if (method === 'DELETE') {
      // The owner removes someone, or someone leaves.
      if (memberId !== user.id) needRole(board, user, ['owner']);
      q.leave.run(id, memberId);
      q.leaveRecent.run(id, memberId);
      closeConnections(id);
      return [200, { ok: true }];
    }
    throw new HttpError(405, 'Method not allowed.');
  }

  return { access, handle, moveGuest, touch: (id) => q.touch.run(Date.now(), id) };
}

/** Read a small JSON request body. */
export async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Bad JSON.');
  }
}
