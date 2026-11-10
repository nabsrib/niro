import { useMemo } from 'react';
import { useBoard } from '../store';
import { DECK, deckSlides, isDeck } from '../frames';
import { glideToBox } from '../cameraGlide';
import type { Item } from '../types';
import { Icons } from './Icons';

/**
 * Screen-space controls for every slide deck: a bar above its top-right corner
 * (Play, Focus, add slide, slide count) and a round + after the last slide.
 */
export function DeckControls() {
  const items = useBoard((s) => s.items);
  const order = useBoard((s) => s.order);
  const camera = useBoard((s) => s.camera);
  const selected = useBoard((s) => s.selected);
  const drop = useBoard((s) => s.deckDrop);
  const interacting = useBoard((s) => s.interacting);
  const decks = useMemo(() => order.map((id) => items[id]).filter(isDeck), [items, order]);

  return (
    <>
      {/* Where a dragged frame will join the deck's row. */}
      {drop && (
        <div
          className="deck-drop"
          style={{
            left: drop.line.x * camera.z + camera.x,
            top: drop.line.y1 * camera.z + camera.y,
            height: (drop.line.y2 - drop.line.y1) * camera.z,
          }}
        />
      )}
      {/* Deck bars stay out of the way while dragging. */}
      {!interacting &&
        decks.map((deck) => {
          const slides = deckSlides(deck, items, order);
          return <DeckBar key={deck.id} deck={deck} slides={slides} selected={selected} camera={camera} />;
        })}
    </>
  );
}

function DeckBar({
  deck,
  slides,
  selected,
  camera,
}: {
  deck: Item;
  slides: Item[];
  selected: string[];
  camera: { x: number; y: number; z: number };
}) {
  const s = useBoard.getState();
  const current = slides.find((f) => selected.includes(f.id));
  const firstShown = slides.find((f) => !f.skipSlide);
  const last = slides[slides.length - 1];

  const addSlide = () => {
    const id = s.addSlide(deck.id);
    const f = id ? useBoard.getState().items[id] : undefined;
    if (f && useBoard.getState().focusId) s.setFocus(f.id);
    else if (f) glideToBox(f, 120, useBoard.getState().camera.z);
  };

  const plus = last
    ? { x: (last.x + last.w + DECK.pad / 2) * camera.z + camera.x, y: (last.y + last.h / 2) * camera.z + camera.y }
    : { x: (deck.x + deck.w / 2) * camera.z + camera.x, y: (deck.y + deck.h / 2) * camera.z + camera.y };

  return (
    <>
      <div
        className="deck-bar"
        data-ui
        style={{ left: (deck.x + deck.w) * camera.z + camera.x, top: deck.y * camera.z + camera.y }}
      >
        <span className="deck-bar__count">
          {slides.length} slide{slides.length === 1 ? '' : 's'}
        </span>
        <button
          className="deck-bar__btn deck-bar__btn--play"
          title={current ? 'Present from the selected slide' : 'Present from the first slide'}
          disabled={!firstShown}
          onClick={() => s.startPresenting(current && !current.skipSlide ? current.id : firstShown?.id)}
        >
          <Icons.play />
          <span>Play</span>
        </button>
        <button
          className="deck-bar__btn"
          title="Focus mode: edit one slide at a time"
          disabled={!slides.length}
          onClick={() => s.setFocus((current ?? slides[0]).id)}
        >
          <Icons.focus />
          <span>Focus</span>
        </button>
        <button className="deck-bar__btn" title="Add a blank slide at the end" onClick={addSlide}>
          <Icons.plus />
          <span>Slide</span>
        </button>
      </div>
      <button
        className="deck-plus"
        data-ui
        title="Add a blank slide"
        aria-label="Add a blank slide"
        style={{ left: plus.x, top: plus.y }}
        onClick={addSlide}
      >
        <Icons.plus />
      </button>
    </>
  );
}
