import type { ArrowHead, Connector, ConnectorStyle, Endpoint, Item, ItemType, LineDash, ShapeKind, Side, Vec } from './types';
import type { BoardContent } from './boardFile';
import { ITEM_DEFAULTS } from './defaults';
import { CONNECTOR_DEFAULTS } from './connectors';

/**
 * Built-in templates (like Miro's): ready-made layouts of ordinary items and
 * connectors. Pure: each template builds plain board content with its own
 * short ids; inserting it (templateActions.ts → store.insertBoard) gives
 * everything fresh ids and centres it on the view, as one undo step.
 */

export type TemplateCategory = 'diagrams' | 'planning' | 'meetings' | 'strategy';

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: 'diagrams', label: 'Diagrams' },
  { id: 'planning', label: 'Planning' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'strategy', label: 'Strategy and research' },
];

export interface TemplateDef {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  build(): BoardContent;
}

// ---------- builder ----------

type LinkOptions = {
  /** Side of the first item the line leaves from (absent = floats on the outline). */
  from?: Side | null;
  /** Side of the second item the line arrives at. */
  to?: Side | null;
  style?: ConnectorStyle;
  label?: string;
  dash?: LineDash;
  start?: ArrowHead;
  end?: ArrowHead;
  stroke?: string;
  width?: number;
};

const GREY_TEXT = '#6B6B76';

/** Collects items and connectors for one template. Item ids are short and local (`t1`, `t2`…). */
class Builder {
  private n = 0;
  items: Item[] = [];
  connectors: Connector[] = [];

  private nextId() {
    return `t${++this.n}`;
  }

  item(type: ItemType, x: number, y: number, w: number, h: number, patch: Partial<Item> = {}): string {
    const id = this.nextId();
    this.items.push({ ...ITEM_DEFAULTS[type], id, x, y, w, h, ...patch });
    return id;
  }

  frame(x: number, y: number, w: number, h: number, title: string, fill = '#FFFFFF'): string {
    return this.item('frame', x, y, w, h, { text: title, fill });
  }

  /** A rectangle item with a shape (plain rectangle when `kind` is 'rect'). */
  shape(kind: ShapeKind, x: number, y: number, w: number, h: number, text: string, fill = '#FFFFFF', patch: Partial<Item> = {}): string {
    return this.item('rect', x, y, w, h, { text, fill, ...(kind !== 'rect' ? { shape: kind } : {}), ...patch });
  }

  sticky(x: number, y: number, text: string, fill = '#FFF9B1', w = 160, h = w): string {
    return this.item('sticky', x, y, w, h, { text, fill, fontSize: 16 });
  }

  text(x: number, y: number, w: number, text: string, size = 24, patch: Partial<Item> = {}): string {
    return this.item('text', x, y, w, Math.round(size * 1.4), { text, fontSize: size, ...patch });
  }

  link(a: string | Vec, b: string | Vec, o: LinkOptions = {}): string {
    const end = (e: string | Vec, side: Side | null | undefined): Endpoint =>
      typeof e === 'string' ? { kind: 'item', itemId: e, side: side ?? null } : { kind: 'point', x: e.x, y: e.y };
    const id = this.nextId();
    this.connectors.push({
      ...CONNECTOR_DEFAULTS,
      id,
      from: end(a, o.from),
      to: end(b, o.to),
      style: o.style ?? 'elbow',
      ...(o.stroke ? { stroke: o.stroke } : {}),
      ...(o.width ? { strokeWidth: o.width } : {}),
      startArrow: o.start ?? 'none',
      endArrow: o.end ?? 'arrow',
      ...(o.dash ? { dash: o.dash } : {}),
      ...(o.label ? { label: o.label } : {}),
    });
    return id;
  }

  done(): BoardContent {
    return { items: this.items, connectors: this.connectors };
  }
}

/** Columns of frames with starter stickies (retro, stand-up, kanban). */
function columns(
  b: Builder,
  cols: { title: string; fill: string; sticky: string; notes: string[] }[],
  opts: { w?: number; h?: number; gap?: number; top?: number; card?: { w: number; h: number } } = {},
) {
  const w = opts.w ?? 340;
  const h = opts.h ?? 560;
  const gap = opts.gap ?? 40;
  const top = opts.top ?? 0;
  cols.forEach((c, i) => {
    const x = i * (w + gap);
    b.frame(x, top, w, h, c.title, c.fill);
    c.notes.forEach((note, j) => {
      if (opts.card) {
        b.sticky(x + (w - opts.card.w) / 2, top + 24 + j * (opts.card.h + 16), note, c.sticky, opts.card.w, opts.card.h);
      } else {
        // Two stickies per row.
        const size = (w - 60) / 2;
        b.sticky(x + 20 + (j % 2) * (size + 20), top + 24 + Math.floor(j / 2) * (size + 20), note, c.sticky, size);
      }
    });
  });
}

// ---------- the templates ----------

function flowchart(): BoardContent {
  const b = new Builder();
  const start = b.shape('pill', 100, 0, 200, 80, 'Start', '#D5F692');
  const enter = b.shape('rect', 100, 150, 200, 100, 'Enter details');
  const valid = b.shape('diamond', 110, 320, 180, 160, 'Valid?', '#FFF9B1');
  const save = b.shape('rect', 100, 550, 200, 100, 'Save order');
  const done = b.shape('pill', 100, 730, 200, 80, 'End', '#F5B6CF');
  const error = b.shape('rect', 420, 350, 200, 100, 'Show error', '#FFFFFF');
  const receipt = b.shape('document', 420, 540, 180, 120, 'Email receipt', '#A6CCF5');
  b.link(start, enter, { from: 'bottom', to: 'top' });
  b.link(enter, valid, { from: 'bottom', to: 'top' });
  b.link(valid, save, { from: 'bottom', to: 'top', label: 'Yes' });
  b.link(valid, error, { from: 'right', to: 'left', label: 'No' });
  b.link(error, enter, { from: 'top', to: 'right' });
  b.link(save, done, { from: 'bottom', to: 'top' });
  b.link(save, receipt, { from: 'right', to: 'left', dash: 'dashed' });
  return b.done();
}

function swimlanes(): BoardContent {
  const b = new Builder();
  const W = 1140;
  const H = 220;
  const lane = (i: number) => i * (H + 48);
  b.frame(0, lane(0), W, H, 'Customer', '#F3F8FF');
  b.frame(0, lane(1), W, H, 'Shop', '#F6FBF1');
  b.frame(0, lane(2), W, H, 'Warehouse', '#FFF9EC');
  const order = b.shape('pill', 40, lane(0) + 70, 180, 80, 'Place order', '#D5F692');
  const check = b.shape('rect', 280, lane(1) + 60, 200, 100, 'Check payment');
  const paid = b.shape('diamond', 560, lane(1) + 30, 160, 160, 'Paid?', '#FFF9B1');
  const remind = b.shape('rect', 820, lane(1) + 60, 200, 100, 'Ask to pay');
  const pack = b.shape('rect', 540, lane(2) + 60, 200, 100, 'Pack and ship');
  const got = b.shape('pill', 860, lane(0) + 70, 200, 80, 'Parcel arrives', '#F5B6CF');
  b.link(order, check, { from: 'right', to: 'top' });
  b.link(check, paid, { from: 'right', to: 'left' });
  b.link(paid, pack, { from: 'bottom', to: 'top', label: 'Yes' });
  b.link(paid, remind, { from: 'right', to: 'left', label: 'No' });
  b.link(pack, got, { from: 'right', to: 'bottom' });
  return b.done();
}

function orgChart(): BoardContent {
  const b = new Builder();
  const line = { from: 'bottom' as const, to: 'top' as const, end: 'none' as const };
  const ceo = b.shape('round', 400, 0, 200, 90, 'CEO\nName', '#A6CCF5', { bold: true });
  const heads = [
    b.shape('round', 100, 170, 200, 90, 'CTO\nName', '#D5F692'),
    b.shape('round', 400, 170, 200, 90, 'CFO\nName', '#D5F692'),
    b.shape('round', 700, 170, 200, 90, 'COO\nName', '#D5F692'),
  ];
  for (const h of heads) b.link(ceo, h, line);
  const tech = [b.shape('round', 0, 340, 180, 80, 'Engineering'), b.shape('round', 220, 340, 180, 80, 'Design')];
  for (const t of tech) b.link(heads[0], t, line);
  b.link(heads[1], b.shape('round', 410, 340, 180, 80, 'Finance'), line);
  b.link(heads[2], b.shape('round', 710, 340, 180, 80, 'Support'), line);
  return b.done();
}

function mindMap(): BoardContent {
  const b = new Builder();
  const center = b.item('ellipse', 400, 250, 240, 130, { text: 'Main idea', fill: '#FFD02F', fontSize: 24, bold: true });
  const branches: { x: number; y: number; text: string; color: string; leaves: { x: number; y: number }[] }[] = [
    { x: 80, y: 60, text: 'Idea 1', color: '#2F6FED', leaves: [{ x: -160, y: 10 }, { x: -160, y: 100 }] },
    { x: 80, y: 470, text: 'Idea 2', color: '#2BA84A', leaves: [{ x: -160, y: 430 }, { x: -160, y: 520 }] },
    { x: 780, y: 60, text: 'Idea 3', color: '#8E44D9', leaves: [{ x: 1020, y: 10 }, { x: 1020, y: 100 }] },
    { x: 780, y: 470, text: 'Idea 4', color: '#F28C28', leaves: [{ x: 1020, y: 430 }, { x: 1020, y: 520 }] },
  ];
  for (const br of branches) {
    const id = b.shape('round', br.x, br.y, 180, 70, br.text, '#FFFFFF', { border: br.color, borderWidth: 3 });
    b.link(center, id, { style: 'curved', end: 'none', stroke: br.color, width: 3 });
    for (const lf of br.leaves) {
      const leaf = b.shape('round', lf.x, lf.y, 140, 54, 'Detail', '#FFFFFF', { border: br.color, borderWidth: 1, fontSize: 16 });
      b.link(id, leaf, { style: 'curved', end: 'none', stroke: br.color });
    }
  }
  return b.done();
}

function kanban(): BoardContent {
  const b = new Builder();
  columns(
    b,
    [
      { title: 'To do', fill: '#F3F4F6', sticky: '#FFF9B1', notes: ['Write the brief', 'Sketch the screens', 'Pick a name'] },
      { title: 'Doing', fill: '#F3F4F6', sticky: '#A6CCF5', notes: ['Build the sign-up page', 'Test on phones'] },
      { title: 'Done', fill: '#F3F4F6', sticky: '#93D275', notes: ['Set up the project'] },
    ],
    { w: 320, h: 600, card: { w: 280, h: 110 } },
  );
  return b.done();
}

function timeline(): BoardContent {
  const b = new Builder();
  b.text(0, -120, 600, 'Project timeline', 36, { bold: true });
  b.link({ x: 0, y: 200 }, { x: 1320, y: 200 }, { style: 'straight', width: 4 });
  const months = ['January', 'February', 'March', 'April', 'May'];
  months.forEach((m, i) => {
    const x = 120 + i * 260;
    const dot = b.item('ellipse', x - 14, 186, 28, 28, { fill: '#1A1A1A', borderWidth: 0 });
    b.text(x - 80, 226, 160, m, 18, { align: 'center', color: GREY_TEXT });
    const above = i % 2 === 0;
    const note = b.sticky(x - 70, above ? -20 : 290, `Milestone ${i + 1}`, above ? '#FFF9B1' : '#A6CCF5', 140);
    b.link(note, dot, { from: above ? 'bottom' : 'top', to: above ? 'top' : 'bottom', style: 'straight', end: 'none', dash: 'dotted' });
  });
  return b.done();
}

function retrospective(): BoardContent {
  const b = new Builder();
  b.text(0, -100, 700, 'Sprint retrospective', 36, { bold: true });
  columns(b, [
    { title: '😀 Went well', fill: '#EEF8E8', sticky: '#93D275', notes: ['', '', ''] },
    { title: '🤔 To improve', fill: '#FFF6DD', sticky: '#FFD02F', notes: ['', '', ''] },
    { title: '✅ Actions', fill: '#E8F1FD', sticky: '#A6CCF5', notes: ['', ''] },
  ]);
  return b.done();
}

function standup(): BoardContent {
  const b = new Builder();
  b.text(0, -100, 700, 'Daily stand-up', 36, { bold: true });
  columns(b, [
    { title: 'Yesterday', fill: '#F3F4F6', sticky: '#FFF9B1', notes: ['', ''] },
    { title: 'Today', fill: '#F3F4F6', sticky: '#A6CCF5', notes: ['', ''] },
    { title: 'Blockers', fill: '#FDECEC', sticky: '#F5B6CF', notes: [''] },
  ]);
  return b.done();
}

function brainstorm(): BoardContent {
  const b = new Builder();
  b.frame(0, 0, 1200, 820, 'Brainstorm');
  b.shape('round', 440, 340, 320, 140, 'What should we build next?', '#C6A2D2', { fontSize: 22, bold: true, borderWidth: 0 });
  const colors = ['#FFF9B1', '#FFD02F', '#FF9D48', '#F5B6CF', '#A6CCF5', '#93D275', '#D5F692', '#FFF9B1'];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const cx = 600 + Math.cos(a) * 430;
    const cy = 410 + Math.sin(a) * 280;
    b.sticky(Math.round(cx - 70), Math.round(cy - 70), '', colors[i], 140);
  }
  return b.done();
}

function swot(): BoardContent {
  const b = new Builder();
  const W = 460;
  const H = 360;
  const cells = [
    { title: 'Strengths', hint: 'What do we do well?', fill: '#EEF8E8', sticky: '#93D275' },
    { title: 'Weaknesses', hint: 'Where are we weak?', fill: '#FDECEC', sticky: '#F5B6CF' },
    { title: 'Opportunities', hint: 'What could we use to our advantage?', fill: '#E8F1FD', sticky: '#A6CCF5' },
    { title: 'Threats', hint: 'What could hurt us?', fill: '#FFF6DD', sticky: '#FFD02F' },
  ];
  cells.forEach((c, i) => {
    const x = (i % 2) * (W + 40);
    const y = Math.floor(i / 2) * (H + 48);
    b.frame(x, y, W, H, c.title, c.fill);
    b.text(x + 24, y + 20, W - 48, c.hint, 18, { color: GREY_TEXT });
    b.sticky(x + 24, y + 70, '', c.sticky, 130);
    b.sticky(x + 174, y + 70, '', c.sticky, 130);
  });
  return b.done();
}

function priorityMatrix(): BoardContent {
  const b = new Builder();
  const S = 380;
  const quads = [
    { x: 10, y: 10, text: 'Quick wins\nHigh impact, little effort', fill: '#EEF8E8' },
    { x: 20 + S, y: 10, text: 'Big bets\nHigh impact, lots of effort', fill: '#E8F1FD' },
    { x: 10, y: 20 + S, text: 'Fill-ins\nLow impact, little effort', fill: '#FFF6DD' },
    { x: 20 + S, y: 20 + S, text: 'Money pit\nLow impact, lots of effort', fill: '#FDECEC' },
  ];
  for (const q of quads) b.shape('rect', q.x, q.y, S, S, q.text, q.fill, { borderWidth: 0, valign: 'top', fontSize: 20 });
  const corner = { x: 0, y: 2 * S + 30 };
  b.link(corner, { x: 0, y: -20 }, { style: 'straight', width: 3 });
  b.link(corner, { x: 2 * S + 50, y: corner.y }, { style: 'straight', width: 3 });
  b.text(-30, -70, 200, 'Impact', 22, { bold: true });
  b.text(2 * S + 70, corner.y - 16, 160, 'Effort', 22, { bold: true });
  return b.done();
}

function journeyMap(): BoardContent {
  const b = new Builder();
  const stages = ['Discover', 'Consider', 'Buy', 'Use', 'Recommend'];
  const rows = ['Actions', 'Thoughts', 'Feelings', 'Pain points', 'Ideas'];
  const head = 180;
  const colW = 240;
  const headH = 70;
  const rowH = 150;
  b.text(0, -90, 700, 'Customer journey map', 36, { bold: true });
  stages.forEach((st, i) => {
    b.shape('rect', head + i * colW, 0, colW, headH, st, '#A6CCF5', { bold: true, border: '#FFFFFF', borderWidth: 2 });
  });
  rows.forEach((r, j) => {
    const y = headH + j * rowH;
    b.shape('rect', 0, y, head, rowH, r, '#F3F4F6', { bold: true, border: '#FFFFFF', borderWidth: 2 });
    stages.forEach((_, i) => {
      b.shape('rect', head + i * colW, y, colW, rowH, '', '#FFFFFF', { border: '#E2E2E8', borderWidth: 1, valign: 'top', fontSize: 16 });
    });
  });
  return b.done();
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'flowchart', name: 'Flowchart', category: 'diagrams', description: 'Start, steps, a yes/no decision and an end.', build: flowchart },
  { id: 'swimlanes', name: 'Swimlane flowchart', category: 'diagrams', description: 'A process split into lanes, one per person or team.', build: swimlanes },
  { id: 'org-chart', name: 'Org chart', category: 'diagrams', description: 'Who reports to whom, top-down.', build: orgChart },
  { id: 'mind-map', name: 'Mind map', category: 'diagrams', description: 'One main idea with branches and details.', build: mindMap },
  { id: 'kanban', name: 'Kanban board', category: 'planning', description: 'To do, Doing, Done columns with cards.', build: kanban },
  { id: 'timeline', name: 'Timeline', category: 'planning', description: 'Milestones along a line, month by month.', build: timeline },
  { id: 'retro', name: 'Retrospective', category: 'meetings', description: 'Went well, To improve, Actions.', build: retrospective },
  { id: 'standup', name: 'Daily stand-up', category: 'meetings', description: 'Yesterday, Today, Blockers.', build: standup },
  { id: 'brainstorm', name: 'Brainstorm', category: 'meetings', description: 'A question in the middle and stickies around it.', build: brainstorm },
  { id: 'swot', name: 'SWOT analysis', category: 'strategy', description: 'Strengths, Weaknesses, Opportunities, Threats.', build: swot },
  { id: 'priority', name: 'Priority matrix', category: 'strategy', description: 'Impact against effort: quick wins to money pits.', build: priorityMatrix },
  { id: 'journey', name: 'Customer journey map', category: 'strategy', description: 'Stages across, actions, thoughts and feelings down.', build: journeyMap },
];
