import { useEffect, useRef, useState, type FormEvent } from 'react';
import { changeName, openAccountDialog, signIn, signOut, signUp, useAccount } from '../account';
import { usePresence } from '../collab/connection';
import { initials } from '../collab/user';

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
        title={`${user.name} · ${user.email}`}
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
            <span>{user.email}</span>
          </div>
          <div className="menu__divider" />
          <button
            role="menuitem"
            className="menu__item"
            onClick={async () => {
              setOpen(false);
              const name = window.prompt('Your name, as others see it:', user.name);
              if (name === null) return;
              const err = await changeName(name);
              if (err) window.alert(err);
            }}
          >
            <span>Change name</span>
          </button>
          <button
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Sign in / Create account dialog. */
export function AccountDialog() {
  const mode = useAccount((s) => s.dialog);
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
  const creating = mode === 'sign-up';
  const close = () => openAccountDialog(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = creating ? await signUp(name, email, password) : await signIn(email, password);
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
      <form className="export-dialog account-dialog" role="dialog" aria-label={creating ? 'Create account' : 'Sign in'} onSubmit={submit}>
        <div className="export-dialog__header">
          <span>{creating ? 'Create your niro account' : 'Sign in to niro'}</span>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
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
        <div className="export-dialog__footer account-dialog__footer">
          <button type="button" className="link-btn" onClick={() => openAccountDialog(creating ? 'sign-in' : 'sign-up')}>
            {creating ? 'I have an account' : 'Create an account'}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
