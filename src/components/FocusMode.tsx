import { useEffect, useMemo } from 'react';
import { useBoard } from '../store';
import { deckSlides, isDeck, slideList } from '../frames';
import { glideToBox } from '../cameraGlide';
import { Icons } from './Icons';

/**
 * Focus mode (like Miro's Slides focus mode): glides to one frame and dims
 * everything around it while editing stays on. The banner steps through the
 * slides (only that deck's slides when the frame is in a deck) and leaves focus mode.
 */
export function FocusMode() {
  const focusId = useBoard((s) => s.focusId);
  const frame = useBoard((s) => (s.focusId ? s.items[s.focusId] : undefined));
  const camera = useBoard((s) => s.camera);
  const items = useBoard((s) => s.items);
  const order = useBoard((s) => s.order);
  // A slide in a deck steps through that deck only; any other frame through every slide.
  const { deck, slides } = useMemo(() => {
    const d = order
      .map((id) => items[id])
      .find((f) => isDeck(f) && deckSlides(f, items, order).some((x) => x.id === focusId));
    return d ? { deck: d, slides: deckSlides(d, items, order) } : { deck: undefined, slides: slideList(items, order) };
  }, [items, order, focusId]);
  const index = slides.findIndex((f) => f.id === focusId);

  // Leave focus mode if the frame is deleted.
  useEffect(() => {
    if (focusId && !frame) useBoard.getState().setFocus(null);
  }, [focusId, frame]);

  // Glide to the frame when focus starts or moves to another frame.
  useEffect(() => {
    if (!focusId) return;
    const f = useBoard.getState().items[focusId];
    return f ? glideToBox(f, 60) : undefined;
  }, [focusId]);

  if (!frame) return null;
  const go = (i: number) => {
    const f = slides[i];
    if (!f) return;
    useBoard.getState().setSelected([f.id]);
    useBoard.getState().setFocus(f.id);
  };

  return (
    <>
      <div
        className="focus-mask"
        aria-hidden="true"
        style={{
          left: frame.x * camera.z + camera.x,
          top: frame.y * camera.z + camera.y,
          width: frame.w * camera.z,
          height: frame.h * camera.z,
        }}
      />
      <div className="focus-banner" data-ui>
        <Icons.focus />
        <button className="icon-btn icon-btn--sm" title="Previous slide" aria-label="Previous slide" disabled={index <= 0} onClick={() => go(index - 1)}>
          <Icons.chevronLeft />
        </button>
        <span>
          {deck && <span className="focus-banner__deck">{deck.text || 'Slides'} · </span>}
          <strong>{frame.text || 'Frame'}</strong>
          {index !== -1 && (
            <span className="focus-banner__count">
              {index + 1} / {slides.length}
            </span>
          )}
        </span>
        <button
          className="icon-btn icon-btn--sm"
          title="Next slide"
          aria-label="Next slide"
          disabled={index === -1 || index >= slides.length - 1}
          onClick={() => go(index + 1)}
        >
          <Icons.chevronRight />
        </button>
        <button className="focus-banner__exit" title="Leave focus mode  Esc" onClick={() => useBoard.getState().setFocus(null)}>
          Exit
        </button>
      </div>
    </>
  );
}
