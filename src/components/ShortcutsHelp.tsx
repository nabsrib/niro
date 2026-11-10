import { Fragment, useEffect, useRef, useState } from 'react';
import { SHORTCUT_GROUPS, keyName, tooltip, type Combo } from '../shortcuts';
import { isEditable } from '../hooks/useKeyboardShortcuts';

/** Round "?" button in the bottom-right corner that opens the shortcuts panel. */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // "?" toggles the panel from anywhere except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside click or Escape. Escape is swallowed so it does not also
  // clear the selection.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="shortcuts" ref={ref} data-ui>
      {open && (
        <div className="shortcuts__panel" role="dialog" aria-label="Keyboard shortcuts">
          <div className="shortcuts__header">
            <span>Keyboard shortcuts</span>
            <button className="shortcuts__close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="shortcuts__body">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title} className="shortcuts__group">
                <h3>{group.title}</h3>
                {group.items.map((item) => (
                  <div key={item.label} className="shortcuts__row">
                    <span>{item.label}</span>
                    <span className="shortcuts__combos">
                      {item.combos.map((combo, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className="shortcuts__or">or</span>}
                          <Keys combo={combo} />
                        </Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
      <button
        className={`shortcuts__button${open ? ' shortcuts__button--active' : ''}`}
        title={tooltip('Keyboard shortcuts', ['?'])}
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
    </div>
  );
}

function Keys({ combo }: { combo: Combo }) {
  return (
    <span className="shortcuts__keys">
      {combo.map((k) => (
        <kbd key={k}>{keyName(k)}</kbd>
      ))}
    </span>
  );
}
