import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { useBoard } from '../store';
import { screenToWorld, uid, worldToScreen } from '../geometry';
import { useAccount } from '../account';
import { usePresence } from '../collab/connection';
import { myIdentity } from '../identity';
import type { CommentMessage, Item, Vec } from '../types';

/**
 * Comments (like Miro): the Comment tool (C) starts a thread where you click;
 * a pin marks it. Click a pin to read and reply, resolve or delete it; drag a pin
 * to move it. A thread is a `comment` item (its spot + `thread` messages), so it
 * syncs, saves and undoes like any item, and moves with the frame it is in.
 * Pins are drawn here in screen space, so they keep their size at any zoom.
 */

interface CommentsState {
  /** The thread that is open. */
  openId: string | null;
  /** A new thread being written at this world point (not on the board until posted). */
  draft: Vec | null;
}

export const useComments = create<CommentsState>(() => ({ openId: null, draft: null }));

/** Start a new comment at a world point (the Comment tool's click). */
export const startComment = (at: Vec) => useComments.setState({ draft: at, openId: null });

const myName = () => useAccount.getState().user?.name ?? usePresence.getState().me.name;

function newMessage(text: string): CommentMessage {
  return { id: uid(), author: myIdentity(), authorName: myName(), text: text.trim().slice(0, 5000), at: Date.now() };
}

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/** Post a message: a new thread from the draft, or a reply. One undo step. */
function post(text: string, threadId: string | null, draft: Vec | null) {
  const s = useBoard.getState();
  if (!text.trim() || s.readOnly) return;
  s.checkpoint();
  if (threadId) {
    const it = s.items[threadId];
    if (it) s.updateItems({ [threadId]: { thread: [...(it.thread ?? []), newMessage(text)], resolved: undefined } });
    return;
  }
  if (!draft) return;
  const item: Item = {
    id: uid(),
    type: 'comment',
    x: draft.x,
    y: draft.y,
    w: 1,
    h: 1,
    fill: 'transparent',
    color: '#1a1a1a',
    text: '',
    fontSize: 14,
    thread: [newMessage(text)],
  };
  useBoard.setState((cur) => ({ items: { ...cur.items, [item.id]: item }, order: [...cur.order, item.id] }));
  useComments.setState({ draft: null, openId: item.id });
}

/** Pins for every comment thread, and the open thread (or draft). */
export function Comments() {
  const items = useBoard((s) => s.items);
  const order = useBoard((s) => s.order);
  const camera = useBoard((s) => s.camera);
  const readOnly = useBoard((s) => s.readOnly);
  const presenting = useBoard((s) => s.presenting !== null);
  const { openId, draft } = useComments();
  const drag = useRef<{ id: string; start: Vec; moved: boolean } | null>(null);
  const threads = order.map((id) => items[id]).filter((it): it is Item => it?.type === 'comment');

  // Esc closes the thread.
  useEffect(() => {
    if (!openId && !draft) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useComments.setState({ openId: null, draft: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, draft]);
  // A deleted thread closes.
  useEffect(() => {
    if (openId && !items[openId]) useComments.setState({ openId: null });
  }, [openId, items]);

  const onPinDown = (e: ReactPointerEvent<HTMLButtonElement>, it: Item) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: it.id, start: { x: e.clientX, y: e.clientY }, moved: false };
  };
  const onPinMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || readOnly) return;
    if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
    const s = useBoard.getState();
    if (!d.moved) {
      d.moved = true;
      s.checkpoint();
    }
    const rect = (document.querySelector('.viewport') as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    const p = screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, s.camera);
    s.updateItems({ [d.id]: { x: p.x, y: p.y } });
  };
  const onPinUp = (it: Item) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) useComments.setState({ openId: openId === it.id ? null : it.id, draft: null });
  };

  if (presenting) return null;
  const open = openId ? items[openId] : undefined;
  const at = open ? { x: open.x, y: open.y } : draft;
  return (
    <div className="comments" aria-label="Comments">
      {threads.map((it) => {
        const p = worldToScreen(it, camera);
        const first = it.thread?.[0];
        return (
          <button
            key={it.id}
            className={`comment-pin${it.resolved ? ' comment-pin--resolved' : ''}${openId === it.id ? ' comment-pin--open' : ''}`}
            data-ui
            style={{ left: p.x, top: p.y }}
            title={`${first?.authorName ?? 'Comment'}: ${first?.text ?? ''}`}
            onPointerDown={(e) => onPinDown(e, it)}
            onPointerMove={onPinMove}
            onPointerUp={() => onPinUp(it)}
          >
            <span>{initial(first?.authorName ?? '?')}</span>
            {(it.thread?.length ?? 0) > 1 && <em>{it.thread!.length}</em>}
          </button>
        );
      })}
      {at && <Thread key={openId ?? 'draft'} item={open} at={worldToScreen(at, camera)} readOnly={readOnly} draft={draft} />}
    </div>
  );
}

function Thread({ item, at, readOnly, draft }: { item?: Item; at: Vec; readOnly: boolean; draft: Vec | null }) {
  const [text, setText] = useState('');
  const s = useBoard.getState();
  const close = () => useComments.setState({ openId: null, draft: null });
  const send = () => {
    post(text, item?.id ?? null, draft);
    setText('');
  };
  return (
    <div className="comment-thread" data-ui style={{ left: at.x + 20, top: at.y - 10 }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="comment-thread__header">
        <span>{item ? (item.resolved ? 'Resolved' : 'Comment') : 'New comment'}</span>
        {item && !readOnly && (
          <>
            <button
              className="link-btn"
              onClick={() => {
                s.checkpoint();
                s.updateItems({ [item.id]: { resolved: item.resolved ? undefined : true } });
              }}
            >
              {item.resolved ? 'Reopen' : 'Resolve'}
            </button>
            <button
              className="link-btn comment-thread__delete"
              onClick={() => {
                if (window.confirm('Delete this comment thread?')) s.deleteItems([item.id]);
              }}
            >
              Delete
            </button>
          </>
        )}
        <button className="icon-btn icon-btn--sm" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <div className="comment-thread__list">
        {item?.thread?.map((m) => (
          <div key={m.id} className="comment-msg">
            <div className="comment-msg__who">
              <strong>{m.authorName}</strong>
              <span>{ago(m.at)}</span>
            </div>
            <div className="comment-msg__text">{m.text}</div>
          </div>
        ))}
      </div>
      {readOnly ? (
        <p className="comment-thread__note">View only: you can read comments but not add them.</p>
      ) : (
        <div className="comment-thread__reply">
          <textarea
            value={text}
            autoFocus
            placeholder={item ? 'Reply…' : 'Write a comment…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
              if (e.key === 'Escape') close();
            }}
          />
          <button className="btn btn--primary" disabled={!text.trim()} onClick={send} title="Post (Ctrl+Enter)">
            {item ? 'Reply' : 'Post'}
          </button>
        </div>
      )}
    </div>
  );
}
