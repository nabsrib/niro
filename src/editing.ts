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

/**
 * The open rich text editor (sticky, shape or text item), so the toolbar can
 * style the selected part of the text while typing.
 */
export interface RichEditApi {
  /** Id of the item being edited. */
  id: string;
  /**
   * Style the selected text. Returns false when nothing is selected: the
   * caller then sets the style for the whole item (the editor has already
   * removed that style from its parts).
   */
  apply(patch: import('./types').RunStyle): boolean;
  /** Style overrides at the selection (empty = the item's own style). */
  current(): import('./types').RunStyle;
}

let activeRich: RichEditApi | null = null;

export function registerRichEdit(api: RichEditApi) {
  activeRich = api;
}

export function unregisterRichEdit(api: RichEditApi) {
  if (activeRich === api) activeRich = null;
}

export function getRichEdit(): RichEditApi | null {
  return activeRich;
}
