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
- Select, Shift-click and marquee multi-select, move, 8-handle resize
  (sticky notes keep their aspect ratio; Shift locks it for others)
- Inline text editing (double-click or Enter), color palette, bring to front / send to back
- Undo/redo, duplicate, copy/cut/paste, delete, arrow-key nudge
- Zoom controls and fit-to-content
- Auto-saves to `localStorage`

## Shortcuts

| Key | Action |
| --- | --- |
| V / H / N / T / R / O | Select / Hand / Sticky / Text / Rectangle / Ellipse |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | Undo, redo |
| Ctrl+D, Ctrl+C / X / V | Duplicate, copy / cut / paste |
| Ctrl+A, Esc | Select all, deselect |
| Del / Backspace | Delete |
| Enter, Esc | Edit selected item, finish editing |
| Arrows (Shift = 10px) | Nudge |
| ] / [ | Bring to front / send to back |
| Ctrl+= / Ctrl+- / Ctrl+0 / Shift+1 | Zoom in / out / 100% / fit |

## Code map

- `src/store.ts`: board state, actions, history, persistence subscription
- `src/geometry.ts`: camera math (screen and world coordinates), hit-testing, resize
- `src/components/Canvas.tsx`: viewport, pointer gestures (pan, move, resize, marquee, create), wheel
- `src/components/ItemView.tsx`: item rendering and inline text editor
- `src/components/SelectionOverlay.tsx`, `ContextToolbar.tsx`, `Toolbar.tsx`, `ZoomControls.tsx`: UI chrome

## Roadmap ideas

1. Connectors/arrows between items, freehand pen
2. Snapping and alignment guides, frames
3. Viewport culling for very large boards
4. Multiple boards and a JSON export/import
5. Real-time collaboration (Yjs + a WebSocket server), then accounts
