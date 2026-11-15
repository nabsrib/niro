import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  changeColor,
  changeName,
  changePassword,
  openAccountDialog,
  signIn,
  signInAsGuest,
  signOut,
  signUp,
  useAccount,
} from '../account';
import { usePresence } from '../collab/connection';
import { USER_COLORS, initials } from '../collab/user';

/**
 * Top-right account control: "Sign in" when signed out, your avatar when signed in
 * (menu: name and email, Change name, Sign out). Hidden while the session loads.
 */
export function AccountButton() {
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const color = usePresence((s) => s.me.color);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (status === 'loading') return null;
  if (!user) {
    return (
      <button className="signin-btn" data-ui onClick={() => openAccountDialog('sign-in')}>
        Sign in
      </button>
    );
  }
  return (
    <div className="account" data-ui ref={ref}>
      <button
        className="avatar avatar--account"
        style={{ background: color }}
        title={user.guest ? `${user.name} · guest (no account)` : `${user.name} · ${user.email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div className="menu account__menu" role="menu">
          <div className="account__who">
            <strong>{user.name}</strong>
            <span>{user.guest ? 'Guest: no account, boards you open stay listed here' : user.email}</span>
          </div>
          <div className="menu__divider" />
          {user.guest && (
            <>
              <button
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  setOpen(false);
                  openAccountDialog('sign-up');
                }}
              >
                <span>Create an account (keeps your boards)</span>
              </button>
              <button
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  setOpen(false);
                  openAccountDialog('sign-in');
                }}
              >
                <span>Sign in to my account</span>
              </button>
            </>
          )}
          <button
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              openAccountDialog('settings');
            }}
          >
            <span>Account settings…</span>
          </button>
          <button
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            <span>{user.guest ? 'Leave guest session' : 'Sign out'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Sign in / Create account dialog. */
export function AccountDialog() {
  const mode = useAccount((s) => s.dialog);
  const signedInGuest = useAccount((s) => !!s.user?.guest);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    setPassword('');
  }, [mode]);

  if (!mode) return null;
  if (mode === 'settings') return <SettingsDialog />;
  const creating = mode === 'sign-up';
  const guest = mode === 'guest';
  const close = () => openAccountDialog(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = guest
      ? await signInAsGuest(name)
      : creating
        ? await signUp(name, email, password)
        : await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else {
      setName('');
      setEmail('');
      setPassword('');
    }
  };

  return (
    <div
      className="modal-backdrop"
      data-ui
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <form
        className="export-dialog account-dialog"
        role="dialog"
        aria-label={guest ? 'Continue as guest' : creating ? 'Create account' : 'Sign in'}
        onSubmit={submit}
      >
        <div className="export-dialog__header">
          <span>{guest ? 'Join as a guest' : creating ? 'Create your niro account' : 'Sign in to niro'}</span>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        {guest ? (
          <div className="account-dialog__body">
            <label>
              Your name (others see it)
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" autoFocus />
            </label>
            <p className="account-dialog__help">
              No email or password. You can open boards whose owner lets guests in; your own boards stay in this browser.
              Create an account any time to keep them.
            </p>
            {error && <p className="account-dialog__error">{error}</p>}
            <p className="account-dialog__help">
              Have an account?{' '}
              <button type="button" className="link-btn" onClick={() => openAccountDialog('sign-in')}>
                Sign in
              </button>{' '}
              or{' '}
              <button type="button" className="link-btn" onClick={() => openAccountDialog('sign-up')}>
                create one
              </button>
              .
            </p>
          </div>
        ) : (
        <div className="account-dialog__body">
          {creating && (
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" autoFocus />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus={!creating}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={creating ? 'new-password' : 'current-password'}
            />
          </label>
          {creating && <p className="account-dialog__help">At least 8 characters. Your password is stored only as a secure hash.</p>}
          {error && <p className="account-dialog__error">{error}</p>}
        </div>
        )}
        <div className="export-dialog__footer account-dialog__footer">
          {guest ? (
            <span />
          ) : (
            <span className="account-dialog__links">
              <button type="button" className="link-btn" onClick={() => openAccountDialog(creating ? 'sign-in' : 'sign-up')}>
                {creating ? 'I have an account' : 'Create an account'}
              </button>
              {!signedInGuest && (
                <button type="button" className="link-btn" onClick={() => openAccountDialog('guest')}>
                  Continue as guest
                </button>
              )}
            </span>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Please wait…' : guest ? 'Continue as guest' : creating ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Account settings: your name and color (as others see you on boards, kept with
 * the account so they are the same on every device), your email, and changing
 * your password (which signs you out on your other devices).
 */
function SettingsDialog() {
  const user = useAccount((s) => s.user);
  const color = usePresence((s) => s.me.color);
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => openAccountDialog(null);
  if (!user) return null;

  /** Run a change and show how it went. */
  const run = async (fn: () => Promise<string | null>, done: string) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    setStatus(err ? { text: err, error: true } : { text: done, error: false });
    return !err;
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== user.name) void run(() => changeName(name), 'Name saved.');
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => changePassword(current, next), 'Password changed. Your other devices were signed out.')) {
      setCurrent('');
      setNext('');
    }
  };

  return (
    <div
      className="modal-backdrop"
      data-ui
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <div className="export-dialog account-dialog settings" role="dialog" aria-label="Account settings">
        <div className="export-dialog__header">
          <span>Account settings</span>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div className="account-dialog__body">
          <div className="settings__who">
            <span className="avatar avatar--account" style={{ background: color }}>
              {initials(name || user.name)}
            </span>
            <span>{user.guest ? 'Guest (no account)' : user.email}</span>
          </div>

          <form className="settings__row" onSubmit={saveName}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" />
            </label>
            <button type="submit" className="btn" disabled={busy || !name.trim() || name.trim() === user.name}>
              Save
            </button>
          </form>

          <div className="settings__colors" role="radiogroup" aria-label="Your color">
            <span>Color (your cursor and avatar)</span>
            <div>
              {USER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === color}
                  aria-label={c}
                  className={`settings__swatch${c === color ? ' is-on' : ''}`}
                  style={{ background: c }}
                  disabled={busy}
                  onClick={() => void run(() => changeColor(c), 'Color saved.')}
                />
              ))}
            </div>
          </div>

          {/* Guests have no password. */}
          {!user.guest && (
          <form className="settings__password" onSubmit={savePassword}>
            <span>Change password</span>
            <input
              type="password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
            />
            <input
              type="password"
              placeholder="New password (8+ characters)"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <button type="submit" className="btn" disabled={busy}>
              Change password
            </button>
          </form>
          )}

          {status && <p className={status.error ? 'account-dialog__error' : 'account-dialog__help'}>{status.text}</p>}
        </div>
        <div className="export-dialog__footer">
          <button type="button" className="btn btn--primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
