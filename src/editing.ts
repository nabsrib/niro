/** Commit function of the text editor that is currently open, if any. */
let activeCommit: (() => void) | null = null;

export function registerActiveEdit(commit: () => void) {
  activeCommit = commit;
}

export function unregisterActiveEdit(commit: () => void) {
  if (activeCommit === commit) activeCommit = null;
}

/**
 * Save and close the open text editor. Called directly (not only via `blur`)
 * because browsers skip focus events when the window itself is not focused.
 */
export function commitActiveEdit() {
  activeCommit?.();
}
