# niro

A Miro-style infinite whiteboard. Step 1: a local, single-user canvas with no accounts and no backend.

## Run

Requires Node 18+ (this repo pins 22 in `.node-version`).

```bash
npm install
npm run dev
```

## Stack

- **React 19 + TypeScript + Vite**
- **Zustand** for board state (items, selection, camera, undo history)
- **DOM rendering with a camera transform**: every item is an absolutely positioned
  element inside one "world" layer. Pan and zoom change a single CSS
  `translate(...) scale(...)`. Selection handles and toolbars render in screen space
  so they stay a constant size at any zoom.

## Features

- Infinite canvas: wheel to pan, Ctrl/Cmd + wheel or pinch to zoom (5%–800%),
  Space + drag, middle mouse or the Hand tool to pan, dotted grid that adapts to zoom
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
- Inline text editing (double-click or Enter), color palette, bring to front / send to back
- Undo/redo, duplicate, copy/cut/paste, delete, arrow-key nudge
- Zoom controls and fit-to-content
- Keyboard shortcuts panel: the round ? button next to the zoom controls (or press ?)
  lists every shortcut by group; shows Cmd/Option keys on a Mac
- Viewport culling: only items and connectors near the screen are rendered (plus selected and
  edited ones), so very large boards stay smooth; everything is still saved, exported and undoable.
  Dev builds show a "rendering X / Y" counter, and `niroStress(5000)` in the browser console fills
  the board with test items (Ctrl+Z removes them)
- Multiple boards: the top-left button shows "Niro / board name"; its menu lists every board
  (open board on top) to switch, plus New board, Rename (or double-click), Duplicate and Delete
  (asks first; deleting the last board leaves a new empty one). The URL (`#board=…`) keeps the
  same board open on reload. A board from older versions moves in automatically as "My board"
- Auto-saves the open board to IndexedDB (the browser's database: lots of space, saves without
  freezing the page), falling back to localStorage when IndexedDB is blocked. A failed save
  (storage full) shows a notice instead of failing silently
- Export image (niro menu, or the image button on a selected frame): PNG (1×, 2×, 3×) or SVG,
  white, board-grey or transparent background, of the whole board, the selection or one frame (cropped to
  it). PNG keeps text exactly as on the board; SVG splits text into lines so it opens correctly
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
- `src/boards.ts`: boards list, startup loading and migration, autosave, switch / new / rename / duplicate / delete
- `src/kv.ts`: key-value storage on IndexedDB with a localStorage fallback
- `src/persistence.ts`: saved board shape, sanitizing loaded data, reading the pre-boards save
- `src/exportImage.ts`: board content to SVG (both text modes), what an export area contains
- `src/exportActions.ts`: text measuring, SVG → PNG, downloads
- `src/components/ExportDialog.tsx`: export image dialog
- `src/components/Canvas.tsx`: viewport, pointer gestures (pan, move, resize, marquee, create), wheel
- `src/components/ItemView.tsx`: item rendering and inline text editor
- `src/components/SelectionOverlay.tsx`, `ContextToolbar.tsx`, `Toolbar.tsx`, `ZoomControls.tsx`, `ShortcutsHelp.tsx`: UI chrome
- `src/components/Presenter.tsx`: Present button, presentation mode (dim mask, slide controls, full screen) and slides grid
- `src/components/FrameOptions.tsx`: Frame tool formats flyout (presets and Slides)
- `src/components/DeckControls.tsx`: slide deck bar (Play, Focus, + Slide) and the + after the last slide
- `src/components/FocusMode.tsx`: focus mode (dim mask, banner with previous / next)
- `src/cameraGlide.ts`: animated camera moves (`glideTo`, `glideToBox`)

## Roadmap ideas

1. Real-time collaboration (Yjs + a WebSocket server), then accounts
2. Level of detail when zoomed far out (simplified items), and a spatial index for 50k+ items
3. Boards dashboard with thumbnails, and pasted images (stored in IndexedDB)
