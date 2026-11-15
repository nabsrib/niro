# niro

A Miro-style infinite whiteboard. Boards are kept in the browser; an optional small server lets
several people edit the same board live and sign in with an account.

## Run

Requires Node 24 (pinned in `.node-version`; the app alone runs on 18+, the server needs 22.5+ for
its built-in SQLite).

```bash
npm install
npm run dev
```

For editing together and accounts, start the niro server in a second terminal (port 1234; boards,
accounts and its secret are kept in `server/data/`, which is git-ignored):

```bash
npm run server
```

The app reaches the server through the Vite dev server (`/api` and `/collab` are forwarded to port
1234), so there is only one address to open. Other devices on your network: run
`npm run dev -- --host`, open the "Network" address Vite prints, and share that link. Without the
server, niro works as before, signed out (the top bar shows "Offline"). To turn the live connection
off, put `VITE_COLLAB_URL=off` in `.env.local` (or point it at another server). Signing in works on
`localhost` and private network addresses (192.168.x.x, 10.x.x.x, 172.x.x.x); add other host names
with `NIRO_HOSTS` when starting the server. Live boards need a signed-in account with access to the
board (owner, member, or link access). The server speaks plain http (no HTTPS yet), so keep it on
your own network.

## Stack

- **React 19 + TypeScript + Vite**
- **Zustand** for board state (items, selection, camera, undo history)
- **DOM rendering with a camera transform**: every item is an absolutely positioned
  element inside one "world" layer. Pan and zoom change a single CSS
  `translate(...) scale(...)`. Selection handles and toolbars render in screen space
  so they stay a constant size at any zoom.

## Features

- Infinite canvas: wheel to pan, Ctrl/Cmd + wheel or pinch to zoom (5%–800%),
  right-drag (like Miro), Space + drag, middle mouse or the Hand tool to pan, dotted grid that
  adapts to zoom
- Items: sticky notes, text, rectangles, ellipses (click to place, or drag to size)
- Connectors: drag from the blue dots around a selected item, or use the Connector tool (L).
  Hovering a dot previews a connected copy of the shape; clicking it creates that copy
  (sliding sideways if the spot is taken) and starts editing its text.
  Ends snap to side midpoints or float on the outline; straight, elbow (routes around the
  connected items) or curved; arrowheads at either end; drag an end to re-attach it.
  Curved connectors have a diamond handle in the middle: drag it to shape the curve,
  double-click it (or use Reset curve) to go back to the automatic curve.
  Labels: double-click a connector (or select it and press Enter, or use the T button)
  to type a label. The line breaks around the text, the label follows the line when
  items move, and you can drag it along the line. Clearing the text removes it.
  With a labeled connector selected, its toolbar sets the label's text size and color
- Snapping: moving or resizing aligns edges and centers with items on screen, with pink
  alignment guides. Moving also snaps to equal spacing: centered between two neighbors, or
  repeating the gap next to a neighbor (A and B are 40 apart, so C snaps 40 past B), with
  pink gap markers showing the distance. It only pulls within a few pixels of the spot;
  hold Alt to move freely
- Pen (P): freehand drawing with 6 colors and 3 widths (widths are in screen pixels at
  the zoom you draw at). Strokes are smoothed, are selected by clicking the line
  itself, and can be moved, resized, recolored, copied and exported like other items
- Highlighter (Shift+P, or the mode switch at the top of the pen options): wide,
  see-through strokes in 5 colors and 3 widths that let text and shapes show through.
  The pen and highlighter each remember their own color and width
- Eraser (E, or the third button in the pen options): rubs out only the part of a pen or
  highlighter stroke it passes over, splitting the stroke where needed. A vertical slider
  in the pen options sets its size (4–80 px), with a matching circle cursor; each drag is
  one undo step. It never erases sticky notes,
  shapes, text, frames or connectors
- Frames (F): titled white areas that sit behind everything. Drag a frame by its title to
  move it with everything inside (items whose center is in it); click its body to
  marquee-select inside; double-click the title to rename; duplicating a frame copies its contents.
  Frames nest: a frame inside a larger frame belongs to it (items belong to the smallest
  frame their center is in), draws in front of it, and moves and copies with it
- Frame tool formats (F opens a flyout, like Miro): Custom (click for 640×360 or drag to
  size), 16:9, 4:3, 1:1, A4, Phone (click to place) and Slides
- Slide decks (Frame tool → Slides, click the canvas): a deck holds slides in one row and
  resizes to fit. A bar above it has Play, Focus and + Slide, and a round + sits after the
  last slide. Drag an existing frame over the deck: a dark line shows where it will join the
  row, and on release it becomes a slide there (it never merges into the slide under it).
  Drag a slide along the row the same way to reorder, drag one out to take it out of the
  deck; deleting a slide closes the gap
- Selected frame toolbar: present from this frame, focus, hide from / show in the presentation
  (decks: play the deck, add a slide)
- Focus mode: dims everything outside one frame while you keep editing; ‹ › step through the
  slides (only that deck's slides when focusing a deck slide); leave with Exit or Esc (with
  nothing selected)
- Present (top-right button, niro menu or Alt+P): every frame on the board becomes a full-screen
  slide (decks as their slides), starting at the selected frame. The camera glides between
  slides and everything outside is dimmed. Arrows, Space, PageUp/PageDown, Home/End navigate;
  Esc exits and restores the view. The bottom-left grid button opens the slides grid: click a
  card to jump, drag cards to reorder the presentation, use the eye to hide a slide. Order and
  hidden state are saved with the board and undoable; frames never reordered follow in
  reading order
- Select, Shift-click and marquee multi-select, move, 8-handle resize
  (sticky notes keep their aspect ratio; Shift locks it for others)
- Inline text editing: double-click (or Enter) a sticky, rectangle, ellipse or text to type in it;
  color palette, bring to front / send to back
- Text options in the toolbar for stickies, shapes and text (like Miro): size, bold, italic,
  underline, horizontal align (left / center / right), vertical align for stickies and shapes
  (top / middle / bottom) and text color. Saved, undoable, and kept in image exports
- Rich text (like Miro): while typing in a sticky, shape or text, the text toolbar stays open.
  Select some words and change their size, bold, italic, underline or color; with nothing selected
  the change applies to the whole item. Ctrl+B / Ctrl+I / Ctrl+U work too. Kept in saves, JSON and
  image exports
- Undo/redo (200 steps; undo only reverts your own changes, ready for shared boards), duplicate,
  copy/cut/paste, delete, arrow-key nudge
- Zoom controls and fit-to-content
- Keyboard shortcuts panel: the round ? button next to the zoom controls (or press ?)
  lists every shortcut by group; shows Cmd/Option keys on a Mac
- Viewport culling: only items and connectors near the screen are rendered (plus selected and
  edited ones), so very large boards stay smooth; everything is still saved, exported and undoable.
  Dev builds show a "rendering X / Y" counter, and `niroStress(5000)` in the browser console fills
  the board with test items (Ctrl+Z removes them)
- Branding: the Niro logo as the browser tab icon and on an animated loading screen (the mark
  pops in and breathes, a bar slides; it stays until the boards load, at least 0.8 s, then fades
  into the board; "reduce motion" turns the movement off); the top-left bar
  (like Miro's) shows the logo mark, the "Niro" wordmark and the board name, plus a quick
  export-image button
- Multiple boards: the top-left bar shows "Niro | board name"; its menu lists every board
  (open board on top) to switch, plus New board, Rename (or double-click), Duplicate and Delete
  (asks first; deleting the last board leaves a new empty one). The URL (`#board=…`) keeps the
  same board open on reload. A board from older versions moves in automatically as "My board"
- Auto-saves the open board to IndexedDB (the browser's database: lots of space, saves without
  freezing the page), falling back to localStorage when IndexedDB is blocked. A failed save
  (storage full) shows a notice instead of failing silently
- Boards are stored as Yjs documents (shared data that merges edits made in several places): the
  groundwork for real-time collaboration. Boards saved by older versions move over the first time
  they open (the old copy stays as a backup). Your view (pan and zoom) is saved apart from the
  board, since each person will have their own
- Tabs stay in sync: open the same board in two tabs and changes in one show up in the other
  right away, merged, never overwritten (no server needed). The boards list (new, renamed,
  deleted boards) updates in every tab too; each tab keeps its own view, selection and undo
- Accounts (with `npm run server`): "Sign in" top-right opens a dialog to sign in or create an
  account (name, email, password of 8+ characters, stored only as a secure hash). Signed in, your
  avatar there opens a menu with your name and email, Account settings and Sign out; others on a
  board see your account name. Account settings: change your name, pick your color (cursor and
  avatar, one of 8; kept with your account, so it is the same on every device) and change your
  password (needs the current one; signs you out on your other devices). All tabs of a browser
  share one sign-in and switch together
- Boards with your account: signed in, the boards menu lists your account's boards (yours, and
  ones shared with you, tagged "Yours", "Can edit · Owner" or "Can view · Owner") plus boards still
  only in this browser ("This browser"). New boards and copies go into your account. Right after
  signing in, niro offers to move this browser's boards into your account (or later: "Move … to my
  account" in the menu). Signing out removes your account's boards from the browser (they stay on
  the server). Signed out, boards are only in the browser and don't sync
- Sharing (Share, top-right): the owner picks who may open the board with its link (only invited
  people, anyone with the link can view, or can edit; always signed in), invites people by the
  email of their niro account as editor or viewer, changes roles and removes people. Everyone sees
  the member list. Removing a board shared with you takes it out of your list; the owner's Delete
  removes it for everyone. A link to a board you may open adds it to your list; otherwise niro
  says why (sign in, no access, deleted)
- Guests (like Miro): the owner can tick "Guests without an account can use the link too" in
  Share (needs link access on). Opening a board link signed out offers "Join as a guest" (just a
  name; others see "Name (guest)") or sign in. Guests open boards that let guests in, with the
  link's role, and see member names but not emails; their own new boards stay in the browser and
  they can't share. Creating an account (or signing in) from the guest menu keeps the boards they
  opened; "Leave guest session" ends it
- View only: on a board where you can only view, the toolbar shows "View only" with just the
  select and hand tools; you can look around, follow, present and export, but nothing changes
  (the server refuses changes too)
- Real-time collaboration (with `npm run server`): everyone with the board's link edits it
  together live, changes merge and are saved on the server; offline edits are kept and shared on
  reconnect. Top-right: connection status (Live / Connecting… / Offline), an avatar per person
  (click to glide to what they see), your own avatar (click to change your name) and Share (copies
  the link). Other people's cursors show with their name and color, and fade after 10 s without
  moving. Names and colors are picked at random the first time and remembered. A link to a board
  you don't have yet adds it as "Shared board"
- Seeing others' work: what each person has selected gets an outline in their color with their
  name; the item someone is typing in shows a dashed outline and "Name is typing…" (starting to
  type in the same item warns that the last one to finish keeps their text)
- Follow (like Miro): click someone's avatar to follow their view (a frame in their color and a
  "Following Name · Stop" pill); pan, zoom, click the board, press Esc or click the avatar again
  to stop. You can't follow someone who follows you; a follower's avatar has a small dot and a pill
  says who is following you. "Bring everyone" (people bar, or the presentation controls) makes
  everyone follow you until you stop or the presentation ends
- Clashing edits are tidied up automatically: a connector attached to an item someone else
  deleted at the same moment gets a free end where the item was, slide decks lay out again after
  two people change them at once, and deleting what someone is typing in tells them
- Export image (niro menu, or the image button on a selected frame): PNG (1×, 2×, 3×) or SVG,
  white, board-grey or transparent background, of the whole board, the current view (what's on
  screen), the selection, one frame (cropped to it) or a custom area: an adjustable window on the
  board (drag to move, edges to resize, ratio chips Free / 16:9 / 4:3 / 1:1 / A4, live pixel size;
  scrolling and zooming still work; Enter = Done, Esc = Cancel). PNG keeps text exactly as on the board; SVG splits text into lines so it opens correctly
  in Figma, Illustrator and Inkscape. Drawn from board data, so off-screen items are included.
  Very large areas are shrunk to fit the browser's PNG size limit (the dialog warns); frame
  outlines, frame titles and thin lines keep a readable pixel size at any scale
- JSON export/import from the niro menu (top-left): Export (Ctrl+S) downloads the board;
  Open (Ctrl+O) replaces the board after confirming; Add drops a file in at the screen
  center, or drop a .json file on the canvas to add it where you drop it. Files are
  validated, invalid entries are skipped, and every import is one undo step. "Open JSON as a
  new board" imports a file into a new board instead

## Shortcuts

| Key | Action |
| --- | --- |
| V / H / N / T / R / O / L / P / F | Select / Hand / Sticky / Text / Rectangle / Ellipse / Connector / Pen / Frame |
| Shift+P / E | Highlighter / Eraser |
| Right-drag, middle-drag, Space + drag | Pan |
| Double-click a sticky, shape or text | Edit its text |
| Alt (while dragging) | Disable snapping |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | Undo, redo |
| Ctrl+D, Ctrl+C / X / V | Duplicate, copy / cut / paste |
| Ctrl+S, Ctrl+O | Export JSON, open JSON (replace board) |
| Ctrl+A, Esc | Select all, deselect |
| Del / Backspace | Delete |
| Enter, Esc | Edit selected item or connector label, finish editing |
| Arrows (Shift = 10px) | Nudge |
| ] / [ | Bring to front / send to back |
| Ctrl+= / Ctrl+- / Ctrl+0 / Shift+1 | Zoom in / out / 100% / fit |
| ? | Show keyboard shortcuts |
| Alt+P | Present frames as slides |
| → / Space, ←, Home / End, Esc | Presenting: next, previous, first / last, close slides grid or exit |

## Code map

- `src/store.ts`: board state, actions, history, persistence subscription
- `src/geometry.ts`: camera math (screen and world coordinates), hit-testing, resize
- `src/connectors.ts`: connector endpoints, attaching, path geometry (straight/elbow/curved), arrowheads, label positions
- `src/culling.ts`: viewport culling (area to render, visible items and connectors)
- `src/devStress.ts`, `src/components/DevStats.tsx`: dev-only stress test and rendered/total counter
- `src/snapping.ts`: edge/center snapping, equal-spacing snapping, alignment guides and gap markers
- `src/frames.ts`: frame membership (nested), render order, slide decks (`deckSlides`, `layoutDeck`), presentation order (`slideList`, `presentationSlides`), frame presets
- `src/pen.ts`: pen and highlighter colors and widths, stroke smoothing, simplification, normalized storage, partial erasing
- `src/shortcuts.ts`: shortcut list for the shortcuts panel, toolbar tooltips and tool keys
- `src/boardFile.ts`: JSON file format, validation, and remapping for import
- `public/`: `logo.png` (original), `logo-mark.png` (the mark, square, transparent), `logo-full.png`
  (mark + wordmark, trimmed), `favicon.png` (64 px), `apple-touch-icon.png` (180 px)
- `src/boards.ts`: boards list, startup loading and migration, autosave, switch / new / rename / duplicate / delete
- `src/kv.ts`: key-value storage on IndexedDB with a localStorage fallback
- `src/persistence.ts`: board data shape, sanitizing loaded data, reading the pre-boards save
- `src/collab/boardDoc.ts`: a board as a Yjs document (layout, filling it from an older save, reading it, storing it)
- `src/collab/bridge.ts`: keeps the store and the open board's Yjs document in step, both ways; undo (`bindHistory`)
- `src/collab/tabSync.ts`: keeps the open board in step with other tabs of the browser (BroadcastChannel)
- `src/collab/connection.ts`: connection to the collaboration server (Hocuspocus provider), presence (`usePresence`: status, peers, you)
- `src/collab/user.ts`: your name and color on shared boards (random at first, remembered)
- `src/components/Presence.tsx`: live cursors, others' selections and typing, follow frame and pill, people bar (status, avatars, Bring everyone, Share)
- `server/index.mjs`: niro server (`npm run server`): live boards (Hocuspocus, saved to `server/data/<id>.ydoc`) and the web API (`/api`), SQLite database `server/data/niro.sqlite`
- `server/auth.mjs`: accounts (Better Auth: email + password, sessions, allowed hosts, secret)
- `server/boards.mjs`: boards, members and link access in SQLite, roles, the `/api/boards` API
- `server/me.mjs`: your settings kept with the account (color), `/api/me`
- `src/account.ts`: your account on the page (`useAccount`, sign up / in / out, change name, tabs in step)
- `src/api.ts`: calls to the boards API (`boardsApi`)
- `src/components/ShareDialog.tsx`: Share dialog (link access, invite, members)
- `src/components/Account.tsx`: Sign in button / account menu, sign-in and create-account dialog, account settings (name, color, password)
- `src/zorder.ts`: z-order as numbers on items (`sortByZ`, `assignZ` renumbers only the items that moved)
- `src/exportImage.ts`: board content to SVG (both text modes), what an export area contains
- `src/exportActions.ts`: text measuring, SVG → PNG, downloads
- `src/textStyle.ts`: text options (fields, defaults, sizes, colors) shared by the board and export
- `src/richText.ts`: rich text runs (pure helpers); `src/richEditor.ts`: rich text editing in the DOM
- `src/components/TextOptions.tsx`: text options in the context toolbar
- `src/components/ExportDialog.tsx`: export image dialog
- `src/components/RegionPicker.tsx`: adjustable custom export area window
- `src/components/Canvas.tsx`: viewport, pointer gestures (pan, move, resize, marquee, create), wheel
- `src/components/ItemView.tsx`: item rendering and inline text editor
- `src/components/SelectionOverlay.tsx`, `ContextToolbar.tsx`, `Toolbar.tsx`, `ZoomControls.tsx`, `ShortcutsHelp.tsx`: UI chrome
- `src/components/Presenter.tsx`: Present button, presentation mode (dim mask, slide controls, full screen) and slides grid
- `src/components/FrameOptions.tsx`: Frame tool formats flyout (presets and Slides)
- `src/components/DeckControls.tsx`: slide deck bar (Play, Focus, + Slide) and the + after the last slide
- `src/components/FocusMode.tsx`: focus mode (dim mask, banner with previous / next)
- `src/cameraGlide.ts`: animated camera moves (`glideTo`, `glideToBox`)

## Roadmap ideas

1. Real-time collaboration (Yjs + a WebSocket server), then accounts. Done: boards stored as Yjs
   documents, undo with Yjs (only your own changes), tabs kept in sync, server + live cursors and
   avatars, others' selections and typing, conflict fixes, follow / bring everyone, sign-in, boards
   with your account, permissions, sharing and view only, account settings, guests. Before going
   public: HTTPS.
   Later extra: typing together in one item (letter-by-letter merging)
2. Level of detail when zoomed far out (simplified items), and a spatial index for 50k+ items
3. Boards dashboard with thumbnails, and pasted images (stored in IndexedDB)
