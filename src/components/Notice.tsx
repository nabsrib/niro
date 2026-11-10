import { useBoard } from '../store';

/** Transient message at the bottom of the screen. */
export function Notice() {
  const notice = useBoard((s) => s.notice);
  if (!notice) return null;
  return (
    <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-ui>
      {notice.text}
    </div>
  );
}
