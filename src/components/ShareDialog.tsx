import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import { useBoard } from '../store';
import { openAccountDialog, useAccount } from '../account';
import { boardsApi, type Member } from '../api';
import { moveLocalBoards, refreshBoards } from '../boards';
import type { LinkAccess, Role } from '../types';

/** Whether the Share dialog is open. */
export const useShare = create<{ open: boolean }>(() => ({ open: false }));
export const openShare = () => useShare.setState({ open: true });

const LINK_LABEL: Record<LinkAccess, string> = {
  none: 'Only people invited',
  view: 'Anyone with the link can view',
  edit: 'Anyone with the link can edit',
};

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };

function copyLink() {
  const { showNotice } = useBoard.getState();
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  void navigator.clipboard.writeText(location.href).then(
    () =>
      showNotice(
        local
          ? 'Link copied. For other devices, open niro with your computer’s network address instead of localhost, then copy the link there.'
          : 'Link copied.',
      ),
    () => showNotice('Could not copy the link; copy it from the address bar.', 'error'),
  );
}

/**
 * Share a board (like Miro): who may open it with the link, invite people by
 * email with a role, and the member list. Only the owner changes access; others
 * see who is on it and can leave. Boards only in this browser are moved into
 * the account first; signed out, it asks to sign in.
 */
export function ShareDialog() {
  const open = useShare((s) => s.open);
  const boardId = useBoard((s) => s.boardId);
  const meta = useBoard((s) => s.boards.find((b) => b.id === s.boardId));
  const user = useAccount((s) => s.user);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const serverBoard = !!meta?.role;
  const isOwner = meta?.role === 'owner';

  // Load the members whenever the dialog opens on a server board.
  useEffect(() => {
    setError(null);
    setMembers(null);
    if (!open || !boardId || !serverBoard) return;
    let live = true;
    boardsApi.members(boardId).then(
      (list) => live && setMembers(list),
      (err: Error) => live && setError(err.message),
    );
    return () => {
      live = false;
    };
  }, [open, boardId, serverBoard]);

  if (!open || !meta || !boardId) return null;
  const close = () => useShare.setState({ open: false });

  /** Run an API change, show its error, then reload members and the boards list. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMembers(await boardsApi.members(boardId));
      await refreshBoards();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await boardsApi.invite(boardId, email.trim(), role);
      setEmail('');
    });
  };

  let body: ReactNode;
  if (!user) {
    body = (
      <div className="share__empty">
        <p>Sign in to share boards. Shared boards sync live, and you decide who can view or edit.</p>
        <button
          className="btn btn--primary"
          onClick={() => {
            close();
            openAccountDialog('sign-in');
          }}
        >
          Sign in
        </button>
      </div>
    );
  } else if (!serverBoard) {
    body = (
      <div className="share__empty">
        <p>This board is only in this browser. Move it into your account to share it.</p>
        <button className="btn btn--primary" disabled={busy} onClick={() => void moveLocalBoards([boardId])}>
          Move to my account
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <div className="share__section">
          <span className="share__label">Link</span>
          {isOwner ? (
            <select
              className="share__select"
              value={meta.linkAccess ?? 'none'}
              disabled={busy}
              onChange={(e) => void run(() => boardsApi.update(boardId, { linkAccess: e.target.value as LinkAccess }))}
            >
              {(Object.keys(LINK_LABEL) as LinkAccess[]).map((k) => (
                <option key={k} value={k}>
                  {LINK_LABEL[k]}
                </option>
              ))}
            </select>
          ) : (
            <span className="share__value">{LINK_LABEL[meta.linkAccess ?? 'none']}</span>
          )}
          <button className="btn" onClick={copyLink}>
            Copy link
          </button>
        </div>
        <p className="share__help">
          People always need a niro account and must be signed in. With "Only people invited", only the people below can open it.
        </p>

        {isOwner && (
          <form className="share__invite" onSubmit={invite}>
            <input
              type="email"
              placeholder="Email of their niro account"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <select className="share__select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Invite
            </button>
          </form>
        )}

        <div className="share__members">
          {!members && !error && <p className="share__help">Loading…</p>}
          {members?.map((m) => (
            <div key={m.id} className="share__member">
              <div className="share__who">
                <strong>
                  {m.name}
                  {m.id === user.id ? ' (you)' : ''}
                </strong>
                <span>{m.email}</span>
              </div>
              {isOwner && m.role !== 'owner' ? (
                <>
                  <select
                    className="share__select"
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => void run(() => boardsApi.setRole(boardId, m.id, e.target.value as Role))}
                  >
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </select>
                  <button
                    className="icon-btn icon-btn--sm"
                    title={`Remove ${m.name}`}
                    aria-label={`Remove ${m.name}`}
                    disabled={busy}
                    onClick={() => void run(() => boardsApi.removeMember(boardId, m.id))}
                  >
                    ×
                  </button>
                </>
              ) : (
                <span className="share__role">{ROLE_LABEL[m.role]}</span>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      className="modal-backdrop"
      data-ui
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <div className="export-dialog share" role="dialog" aria-label="Share board">
        <div className="export-dialog__header">
          <span>Share “{meta.name}”</span>
          <button className="icon-btn icon-btn--sm" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div className="share__body">
          {body}
          {error && <p className="account-dialog__error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
