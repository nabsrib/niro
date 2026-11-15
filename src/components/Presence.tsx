import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useBoard } from '../store';
import { screenToWorld, worldToScreen } from '../geometry';
import { follow, myId, publishCursor, renameMe, setLead, usePresence, type ConnectionStatus, type Peer } from '../collab/connection';
import { initials } from '../collab/user';
import type { Box } from '../types';

/** A cursor that hasn't moved for this long fades out. */
const IDLE_MS = 10_000;
/** Avatars shown before "+N". */
const MAX_AVATARS = 5;
/** More selected items than this are outlined as one box. */
const MAX_OUTLINES = 40;

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  off: '',
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline',
};

const STATUS_TITLE: Record<ConnectionStatus, string> = {
  off: '',
  connecting: 'Connecting to the collaboration server…',
  online: 'Connected: changes are shared live',
  offline: 'Server not reachable. Your changes are kept here and shared when it is back (npm run server).',
};

/** Screen rectangle of a world box, or null when it is off screen. */
function onScreen(b: Box, camera: { x: number; y: number; z: number }, vw: number, vh: number) {
  const p = worldToScreen(b, camera);
  const w = b.w * camera.z;
  const h = b.h * camera.z;
  if (p.x > vw || p.y > vh || p.x + w < 0 || p.y + h < 0) return null;
  return { left: p.x, top: p.y, width: w, height: h };
}

/**
 * Other people's selections (an outline in their color, their name on the first
 * one) and the item each one is typing in ("Name is typing…"). Screen space,
 * under the cursors; never catches the mouse.
 */
export function PeerSelections() {
  const peers = usePresence((s) => s.peers);
  const camera = useBoard((s) => s.camera);
  const viewport = useBoard((s) => s.viewport);
  const items = useBoard((s) => s.items);
  if (!peers.length) return null;

  const marks: ReactNode[] = [];
  for (const p of peers) {
    const style = { '--c': p.user.color } as CSSProperties;
    const boxes: Box[] = [];
    if (p.selectionBox) boxes.push(p.selectionBox);
    else {
      const sel = p.selection.map((id) => items[id]).filter(Boolean);
      if (sel.length > MAX_OUTLINES) {
        const x = Math.min(...sel.map((b) => b.x));
        const y = Math.min(...sel.map((b) => b.y));
        boxes.push({ x, y, w: Math.max(...sel.map((b) => b.x + b.w)) - x, h: Math.max(...sel.map((b) => b.y + b.h)) - y });
      } else boxes.push(...sel);
    }
    let named = false;
    boxes.forEach((b, i) => {
      const r = onScreen(b, camera, viewport.w, viewport.h);
      if (!r) return;
      marks.push(
        <div key={`${p.id}-s${i}`} className="peer-sel" style={{ ...style, ...r }}>
          {!named && <span className="peer-tag">{p.user.name}</span>}
        </div>,
      );
      named = true;
    });
    const editing = p.editing ? items[p.editing] : undefined;
    const r = editing && onScreen(editing, camera, viewport.w, viewport.h);
    if (r) {
      marks.push(
        <div key={`${p.id}-e`} className="peer-sel peer-sel--typing" style={{ ...style, ...r }}>
          <span className="peer-tag">{p.user.name} is typing…</span>
        </div>,
      );
    }
  }
  return (
    <div className="peer-layer" aria-hidden="true">
      {marks}
    </div>
  );
}

/**
 * Other people's cursors (screen space, drawn over the board), and publishing
 * this person's cursor as they move the mouse over the board. Also stops
 * following someone when this person pans, zooms, clicks the board or presses Esc.
 */
export function Cursors() {
  const peers = usePresence((s) => s.peers);
  const camera = useBoard((s) => s.camera);
  // Re-check idle cursors every second while anyone else is here.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!peers.length) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [peers.length]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = document.querySelector('.viewport');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (p.x < 0 || p.y < 0 || p.x > r.width || p.y > r.height) publishCursor(null);
      else publishCursor(screenToWorld(p, useBoard.getState().camera));
    };
    const onLeave = () => publishCursor(null);
    const stopFollowing = () => {
      if (usePresence.getState().following !== null) follow(null);
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.viewport')) stopFollowing();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopFollowing();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', stopFollowing, { capture: true, passive: true });
    window.addEventListener('keydown', onKey);
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', stopFollowing, { capture: true });
      window.removeEventListener('keydown', onKey);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  const now = Date.now();
  return (
    <div className="cursors" aria-hidden="true">
      {peers.map((p) => {
        if (!p.cursor) return null;
        const s = worldToScreen(p.cursor, camera);
        return (
          <div
            key={p.id}
            className={`cursor${now - p.seen > IDLE_MS ? ' cursor--idle' : ''}`}
            style={{ transform: `translate(${s.x}px, ${s.y}px)`, '--c': p.user.color } as CSSProperties}
          >
            <svg viewBox="0 0 18 18">
              <path d="M2 1.5 L15.5 8.2 L9.2 9.6 L6.4 15.8 Z" />
            </svg>
            <span className="cursor__name">{p.user.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * While following someone: a frame in their color around the screen and a
 * "Following Name · Stop" pill. While bringing everyone along: "Everyone follows
 * you · Stop". Shown in presentations too.
 */
export function FollowBanner() {
  const following = usePresence((s) => s.following);
  const leading = usePresence((s) => s.leading);
  const peers = usePresence((s) => s.peers);
  const peer = following === null ? undefined : peers.find((p) => p.id === following);
  if (peer) {
    return (
      <>
        <div className="follow-frame" style={{ '--c': peer.user.color } as CSSProperties} aria-hidden="true" />
        <div className="follow-pill" data-ui style={{ '--c': peer.user.color } as CSSProperties}>
          <span>Following {peer.user.name}</span>
          <button onClick={() => follow(null)}>Stop</button>
        </div>
      </>
    );
  }
  if (leading) {
    return (
      <div className="follow-pill follow-pill--lead" data-ui>
        <span>{peers.length ? 'Everyone is following you' : 'Bringing everyone here (nobody else is on the board)'}</span>
        <button onClick={() => setLead(false)}>Stop</button>
      </div>
    );
  }
  const me = myId();
  const followers = peers.filter((p) => me !== null && p.follows === me);
  if (!followers.length) return null;
  return (
    <div className="follow-pill follow-pill--quiet" data-ui>
      <span>
        {followers.length === 1 ? `${followers[0].user.name} is following you` : `${followers.length} people are following you`}
      </span>
    </div>
  );
}

/** "Bring everyone to me" toggle (people bar and presentation controls). */
export function BringEveryoneButton({ className }: { className: string }) {
  const status = usePresence((s) => s.status);
  const leading = usePresence((s) => s.leading);
  if (status === 'off') return null;
  return (
    <button
      className={`${className}${leading ? ' is-on' : ''}`}
      title={leading ? 'Let everyone look around again' : 'Everyone on the board follows your view'}
      onClick={() => setLead(!leading)}
    >
      {leading ? 'Stop bringing' : 'Bring everyone'}
    </button>
  );
}

function shareLink() {
  const { showNotice } = useBoard.getState();
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  void navigator.clipboard.writeText(location.href).then(
    () =>
      showNotice(
        local
          ? 'Link copied. For other devices, open niro with your computer’s network address instead of localhost, then share that link.'
          : 'Link copied: anyone who can reach this server can open and edit this board.',
      ),
    () => showNotice('Could not copy the link; copy it from the address bar.', 'error'),
  );
}

/** Click someone's avatar: follow their view (click again to stop). */
function toggleFollow(p: Peer) {
  if (usePresence.getState().following === p.id) return follow(null);
  if (!p.view) return useBoard.getState().showNotice(`${p.user.name}'s view isn't known yet.`);
  follow(p.id);
}

/**
 * Top-right: connection status, who is on the board (click to follow), your own
 * avatar (click to rename), Bring everyone, Share.
 */
export function PeopleBar() {
  const status = usePresence((s) => s.status);
  const peers = usePresence((s) => s.peers);
  const me = usePresence((s) => s.me);
  const following = usePresence((s) => s.following);
  if (status === 'off') return null;
  const shown = peers.slice(0, MAX_AVATARS);
  const mine = myId();
  const avatarTitle = (p: Peer) => {
    if (following === p.id) return `Following ${p.user.name} · click to stop`;
    if (mine !== null && p.follows === mine) return `${p.user.name} is following you`;
    return `${p.user.name} · click to follow their view`;
  };
  return (
    <div className="people" data-ui>
      <span className={`conn conn--${status}`} title={STATUS_TITLE[status]}>
        <i />
        {STATUS_LABEL[status]}
      </span>
      {shown.map((p) => (
        <button
          key={p.id}
          className={`avatar${following === p.id ? ' avatar--followed' : ''}${mine !== null && p.follows === mine ? ' avatar--follows-me' : ''}`}
          style={{ background: p.user.color, '--c': p.user.color } as CSSProperties}
          title={avatarTitle(p)}
          onClick={() => toggleFollow(p)}
        >
          {initials(p.user.name)}
        </button>
      ))}
      {peers.length > shown.length && (
        <span className="avatar avatar--more" title={peers.slice(MAX_AVATARS).map((p) => p.user.name).join(', ')}>
          +{peers.length - shown.length}
        </span>
      )}
      <button
        className="avatar avatar--me"
        style={{ background: me.color }}
        title={`You: ${me.name} · click to change your name`}
        onClick={() => {
          const name = window.prompt('Your name, as others see it:', me.name);
          if (name !== null) renameMe(name);
        }}
      >
        {initials(me.name)}
      </button>
      {peers.length > 0 && <BringEveryoneButton className="people-btn" />}
      <button className="people-btn share-btn" title="Copy a link to this board" onClick={shareLink}>
        Share
      </button>
    </div>
  );
}
