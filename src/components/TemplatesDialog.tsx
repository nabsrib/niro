import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useBoard } from '../store';
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from '../templates';
import {
  deleteMyTemplate,
  insertTemplate,
  loadMyTemplates,
  renameMyTemplate,
  saveSelectionAsTemplate,
  useMyTemplates,
} from '../templateActions';
import { collectExport, contentToSvg } from '../exportImage';
import { measureText } from '../exportActions';
import type { BoardContent } from '../boardFile';
import { Icons } from './Icons';

/** Whether the templates gallery is open. */
export const useTemplatesDialog = create<{ open: boolean }>(() => ({ open: false }));
export const toggleTemplates = () => useTemplatesDialog.setState((s) => ({ open: !s.open }));
const close = () => useTemplatesDialog.setState({ open: false });

type Tab = TemplateCategory | 'all' | 'mine';

const THUMB_W = 240;
const THUMB_H = 140;

/** Built-in templates never change, so their pictures are drawn once. */
const builtInThumbs = new Map<string, string | null>();

/** Template content as a small SVG picture (data URL), drawn like an image export. */
function thumbnail(content: BoardContent): string | null {
  const items = Object.fromEntries(content.items.map((it) => [it.id, it]));
  const order = content.items.map((it) => it.id);
  const conns = Object.fromEntries(content.connectors.map((c) => [c.id, c]));
  const first = collectExport({ kind: 'board' }, items, order, conns, []);
  if (!first) return null;
  const k = Math.min(THUMB_W / first.bounds.w, THUMB_H / first.bounds.h, 1);
  const ex = collectExport({ kind: 'board' }, items, order, conns, [], k) ?? first;
  // Text as lines (no HTML inside an <img>); pictures of image items show as grey boxes.
  const svg = contentToSvg(ex, items, { textMode: 'lines', measure: measureText, background: null, pxPerUnit: k });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function builtInThumb(id: string, build: () => BoardContent): string | null {
  if (!builtInThumbs.has(id)) builtInThumbs.set(id, thumbnail(build()));
  return builtInThumbs.get(id) ?? null;
}

/**
 * Templates gallery (toolbar button or Shift+T): ready-made layouts by
 * category, plus your own saved templates. Click one to add it to the middle
 * of the view.
 */
export function TemplatesDialog() {
  const open = useTemplatesDialog((s) => s.open);
  if (!open) return null;
  return <Dialog />;
}

function Dialog() {
  const [tab, setTab] = useState<Tab>('all');
  const mine = useMyTemplates((s) => s.list);
  const loaded = useMyTemplates((s) => s.loaded);
  const hasSelection = useBoard((s) => s.selected.length > 0);

  useEffect(() => {
    if (!loaded) void loadMyTemplates();
  }, [loaded]);

  // Esc closes the gallery only (not the selection).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const builtIns = tab === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.category === tab);
  const mineThumbs = useMemo(() => new Map(mine.map((t) => [t.id, thumbnail(t)])), [mine]);

  const use = (content: BoardContent, name: string) => {
    insertTemplate(content, name);
    close();
  };

  return (
    <div className="modal-backdrop" data-ui onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="templates-dialog" role="dialog" aria-label="Templates">
        <div className="export-dialog__header">
          <span>Templates</span>
          <button className="icon-btn icon-btn--sm" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div className="templates-dialog__body">
          <nav className="templates-dialog__nav">
            {[{ id: 'all' as Tab, label: 'All templates' }, ...TEMPLATE_CATEGORIES].map((c) => (
              <button key={c.id} className={tab === c.id ? 'is-active' : ''} onClick={() => setTab(c.id)}>
                {c.label}
              </button>
            ))}
            <div className="menu__divider" />
            <button className={tab === 'mine' ? 'is-active' : ''} onClick={() => setTab('mine')}>
              My templates{mine.length ? ` (${mine.length})` : ''}
            </button>
          </nav>

          <div className="templates-dialog__main">
            {tab === 'mine' ? (
              <>
                <div className="templates-dialog__bar">
                  <span className="templates-dialog__help">Saved in this browser. Select items on the board, then save them here.</span>
                  <button
                    className="btn"
                    disabled={!hasSelection}
                    title={hasSelection ? undefined : 'Select something on the board first'}
                    onClick={() => void saveSelectionAsTemplate()}
                  >
                    Save selection as template
                  </button>
                </div>
                {loaded && !mine.length && (
                  <p className="templates-dialog__empty">
                    No saved templates yet. Select items on the board and use “Save as template” in their toolbar.
                  </p>
                )}
                <div className="templates-grid">
                  {mine.map((t) => (
                    <div key={t.id} className="template-card">
                      <button className="template-card__pick" title="Add to the board" onClick={() => use(t, t.name)}>
                        <Thumb src={mineThumbs.get(t.id) ?? null} />
                        <span className="template-card__name">{t.name}</span>
                        <span className="template-card__desc">
                          {t.items.length} item{t.items.length === 1 ? '' : 's'} · {new Date(t.createdAt).toLocaleDateString()}
                        </span>
                      </button>
                      <div className="template-card__actions">
                        <button
                          className="icon-btn icon-btn--sm"
                          title="Rename"
                          aria-label="Rename"
                          onClick={() => {
                            const name = window.prompt('Rename template:', t.name);
                            if (name) void renameMyTemplate(t.id, name);
                          }}
                        >
                          <Icons.pencil />
                        </button>
                        <button
                          className="icon-btn icon-btn--sm"
                          title="Delete"
                          aria-label="Delete"
                          onClick={() => window.confirm(`Delete the template "${t.name}"?`) && void deleteMyTemplate(t.id)}
                        >
                          <Icons.trash />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="templates-grid">
                {builtIns.map((t) => (
                  <div key={t.id} className="template-card">
                    <button className="template-card__pick" title="Add to the board" onClick={() => use(t.build(), t.name)}>
                      <Thumb src={builtInThumb(t.id, t.build)} />
                      <span className="template-card__name">{t.name}</span>
                      <span className="template-card__desc">{t.description}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Thumb({ src }: { src: string | null }) {
  return <span className="template-card__thumb">{src && <img src={src} alt="" draggable={false} />}</span>;
}
