import type { ArrowHead, Connector, ConnectorStyle, Endpoint, Item, ItemType, LineDash, ShapeKind, Side, Vec } from './types';
import type { BoardContent } from './boardFile';
import { ITEM_DEFAULTS } from './defaults';
import { CONNECTOR_DEFAULTS } from './connectors';
import { isTreeRoot, layoutTree } from './trees';
import { layoutStack } from './frames';

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
  /** Small text at each end (UML multiplicity). */
  startLabel?: string;
  endLabel?: string;
  dash?: LineDash;
  start?: ArrowHead;
  end?: ArrowHead;
  stroke?: string;
  width?: number;
  /** A mind map / tree branch line (the tree layout restyles it). */
  branch?: boolean;
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
      ...(o.branch ? { branch: true } : {}),
      ...(o.startLabel ? { startLabel: o.startLabel } : {}),
      ...(o.endLabel ? { endLabel: o.endLabel } : {}),
    });
    return id;
  }

  done(): BoardContent {
    // Mind maps and trees come laid out (also for the gallery's thumbnails).
    let items = Object.fromEntries(this.items.map((it) => [it.id, it]));
    let connectors = Object.fromEntries(this.connectors.map((c) => [c.id, c]));
    const applyItems = (patch: Record<string, Partial<Item>>) => {
      items = Object.fromEntries(Object.entries(items).map(([id, it]) => [id, patch[id] ? { ...it, ...patch[id] } : it]));
    };
    for (const root of this.items.filter(isTreeRoot)) {
      const p = layoutTree(root.id, items, connectors);
      applyItems(p.items);
      connectors = Object.fromEntries(Object.entries(connectors).map(([id, c]) => [id, p.connectors[id] ? { ...c, ...p.connectors[id] } : c]));
    }
    // Kanban columns come stacked.
    const order = this.items.map((it) => it.id);
    for (const f of this.items.filter((it) => it.type === 'frame' && it.stack)) applyItems(layoutStack(items[f.id], items, order));
    return { items: this.items.map((it) => items[it.id]), connectors: this.connectors.map((c) => connectors[c.id]) };
  }
}

/** Columns of frames with starter stickies (retro, stand-up, kanban). */
function columns(
  b: Builder,
  cols: { title: string; fill: string; sticky: string; notes: string[] }[],
  opts: { w?: number; h?: number; gap?: number; top?: number; card?: { w: number; h: number }; stack?: boolean } = {},
) {
  const w = opts.w ?? 340;
  const h = opts.h ?? 560;
  const gap = opts.gap ?? 40;
  const top = opts.top ?? 0;
  cols.forEach((c, i) => {
    const x = i * (w + gap);
    const frame = b.frame(x, top, w, h, c.title, c.fill);
    // Kanban: cards stack in a tidy column.
    if (opts.stack) b.items.find((it) => it.id === frame)!.stack = true;
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

/** An org chart: a real tree, laid out top-down (Tab adds a report, Enter a colleague). */
function orgChart(): BoardContent {
  const b = new Builder();
  const node = (parent: string | null, text: string, fill: string, x: number) =>
    b.shape('round', x, parent ? 200 : 0, 190, 80, text, fill, {
      border: '#1A1A1A',
      borderWidth: 2,
      tree: parent ? { parent } : { layout: 'org' },
      ...(parent ? {} : { bold: true }),
    });
  const line = (from: string, to: string) => b.link(from, to, { from: 'bottom', to: 'top', end: 'none', branch: true });
  const ceo = node(null, 'CEO\nName', '#A6CCF5', 400);
  const heads = [node(ceo, 'CTO\nName', '#D5F692', 100), node(ceo, 'CFO\nName', '#D5F692', 400), node(ceo, 'COO\nName', '#D5F692', 700)];
  heads.forEach((h) => line(ceo, h));
  const teams: [number, string, number][] = [[0, 'Engineering', 0], [0, 'Design', 220], [1, 'Finance', 410], [2, 'Support', 710]];
  for (const [head, text, x] of teams) line(heads[head], node(heads[head], text, '#FFFFFF', x));
  return b.done();
}

/** A mind map: a real tree (Tab adds a child, Enter a sibling; it lays itself out). */
function mindMap(): BoardContent {
  const b = new Builder();
  const center = b.shape('round', 400, 250, 240, 90, 'Main idea', '#FFD02F', {
    fontSize: 24,
    bold: true,
    borderWidth: 0,
    tree: { layout: 'mind' },
  });
  const branches: { x: number; y: number; text: string; color: string }[] = [
    { x: 80, y: 60, text: 'Idea 1', color: '#2F6FED' },
    { x: 80, y: 470, text: 'Idea 2', color: '#2BA84A' },
    { x: 780, y: 60, text: 'Idea 3', color: '#8E44D9' },
    { x: 780, y: 470, text: 'Idea 4', color: '#F28C28' },
  ];
  for (const br of branches) {
    const id = b.shape('round', br.x, br.y, 180, 56, br.text, '#FFFFFF', { border: br.color, borderWidth: 2, tree: { parent: center } });
    b.link(center, id, { style: 'curved', end: 'none', stroke: br.color, width: 3, branch: true });
    for (let i = 0; i < 2; i++) {
      const left = br.x < 400;
      const leaf = b.shape('round', left ? br.x - 230 : br.x + 250, br.y + i * 60, 160, 48, 'Detail', '#FFFFFF', {
        border: br.color,
        borderWidth: 2,
        fontSize: 16,
        tree: { parent: id },
      });
      b.link(id, leaf, { style: 'curved', end: 'none', stroke: br.color, branch: true });
    }
  }
  return b.done();
}

function classDiagram(): BoardContent {
  const b = new Builder();
  const cls = (x: number, y: number, h: number, text: string) => b.shape('class', x, y, 240, h, text, '#FFFFFF', { fontSize: 16 });
  const user = cls(0, 0, 150, 'User\n--\n- id: string\n- email: string\n--\n+ signIn()\n+ signOut()');
  const board = cls(440, 0, 150, 'Board\n--\n- id: string\n- name: string\n--\n+ share(user)\n+ rename(name)');
  const guest = cls(0, 300, 110, 'GuestUser\n--\n- expiresAt: Date\n--\n+ upgrade()');
  const member = cls(440, 300, 110, 'Member\n--\n- role: Role\n--\n+ canEdit()');
  b.link(guest, user, { from: 'top', to: 'bottom', end: 'triangle', style: 'straight' });
  b.link(user, board, { from: 'right', to: 'left', start: 'diamond', end: 'none', label: 'owns', startLabel: '1', endLabel: '*' });
  b.link(board, member, { from: 'bottom', to: 'top', start: 'hollowDiamond', end: 'none', startLabel: '1', endLabel: '*' });
  b.link(member, user, { from: 'left', to: 'right', end: 'open', dash: 'dashed', label: 'refers to' });
  b.text(0, -70, 400, 'Inherits ▷   Owns ◆   Has ◇   Uses ┄›', 16, { color: GREY_TEXT });
  return b.done();
}

function erDiagram(): BoardContent {
  const b = new Builder();
  const table = (x: number, y: number, w: number, h: number, text: string) =>
    b.shape('entity', x, y, w, h, text, '#A6CCF5', { fontSize: 16 });
  const users = table(0, 0, 200, 140, 'users\nid  PK\nemail\nname\ncreated_at');
  const boards = table(420, 0, 200, 140, 'boards\nid  PK\nname\nowner_id  FK\nlink_access');
  const members = table(420, 260, 220, 120, 'board_members\nboard_id  FK\nuser_id  FK\nrole');
  const sessions = table(0, 260, 200, 120, 'sessions\nid  PK\nuser_id  FK\nexpires_at');
  const rel = { start: 'one' as const, end: 'zeroMany' as const };
  b.link(users, boards, { ...rel, from: 'right', to: 'left', label: 'owns' });
  b.link(boards, members, { ...rel, from: 'bottom', to: 'top' });
  b.link(users, sessions, { ...rel, from: 'bottom', to: 'top' });
  b.link(users, members, { ...rel, to: 'left', style: 'straight' });
  return b.done();
}

function useCaseDiagram(): BoardContent {
  const b = new Builder();
  b.frame(250, 0, 420, 540, 'Online shop');
  const actor = (x: number, y: number, name: string) => b.shape('actor', x, y, 90, 160, name, '#FFFFFF', { fontSize: 16 });
  const customer = actor(60, 110, 'Customer');
  const admin = actor(780, 300, 'Admin');
  const uc = (y: number, text: string) => b.item('ellipse', 320, y, 280, 90, { text, fontSize: 18 });
  const browse = uc(40, 'Browse products');
  const order = uc(160, 'Place order');
  const pay = uc(280, 'Pay');
  const manage = uc(410, 'Manage products');
  const plain = { style: 'straight' as const, end: 'none' as const };
  b.link(customer, browse, plain);
  b.link(customer, order, plain);
  b.link(admin, manage, plain);
  b.link(order, pay, { from: 'bottom', to: 'top', style: 'straight', end: 'open', dash: 'dashed', label: '«include»' });
  return b.done();
}

function stateDiagram(): BoardContent {
  const b = new Builder();
  const start = b.item('ellipse', 0, 60, 36, 36, { fill: '#1A1A1A', borderWidth: 0 });
  const state = (x: number, y: number, text: string) => b.shape('round', x, y, 170, 76, text, '#FFFFFF');
  const draft = state(100, 40, 'Draft');
  const review = state(360, 40, 'In review');
  const published = state(620, 40, 'Published');
  const archived = state(620, 230, 'Archived');
  // End state: a ring with a dot in it.
  const end = b.item('ellipse', 880, 249, 40, 40, { fill: '#FFFFFF', border: '#1A1A1A', borderWidth: 3 });
  b.item('ellipse', 889, 258, 22, 22, { fill: '#1A1A1A', borderWidth: 0 });
  const s = { style: 'straight' as const };
  b.link(start, draft, { ...s, to: 'left' });
  b.link(draft, review, { ...s, from: 'right', to: 'left', label: 'submit' });
  b.link(review, draft, { from: 'bottom', to: 'bottom', label: 'changes needed' });
  b.link(review, published, { ...s, from: 'right', to: 'left', label: 'approve' });
  b.link(published, archived, { ...s, from: 'bottom', to: 'top', label: 'archive' });
  b.link(archived, end, { ...s, from: 'right', to: 'left' });
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
    { w: 320, h: 600, card: { w: 280, h: 110 }, stack: true },
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
  { id: 'uml-class', name: 'UML class diagram', category: 'diagrams', description: 'Classes with fields and methods; inherits, owns, has.', build: classDiagram },
  { id: 'er', name: 'ER diagram (database)', category: 'diagrams', description: 'Tables, keys and crow’s-foot relations.', build: erDiagram },
  { id: 'use-case', name: 'Use case diagram', category: 'diagrams', description: 'Actors, a system boundary and what they can do.', build: useCaseDiagram },
  { id: 'state', name: 'State diagram', category: 'diagrams', description: 'Start, states, transitions and an end.', build: stateDiagram },
  { id: 'kanban', name: 'Kanban board', category: 'planning', description: 'To do, Doing, Done columns with cards.', build: kanban },
  { id: 'timeline', name: 'Timeline', category: 'planning', description: 'Milestones along a line, month by month.', build: timeline },
  { id: 'retro', name: 'Retrospective', category: 'meetings', description: 'Went well, To improve, Actions.', build: retrospective },
  { id: 'standup', name: 'Daily stand-up', category: 'meetings', description: 'Yesterday, Today, Blockers.', build: standup },
  { id: 'brainstorm', name: 'Brainstorm', category: 'meetings', description: 'A question in the middle and stickies around it.', build: brainstorm },
  { id: 'swot', name: 'SWOT analysis', category: 'strategy', description: 'Strengths, Weaknesses, Opportunities, Threats.', build: swot },
  { id: 'priority', name: 'Priority matrix', category: 'strategy', description: 'Impact against effort: quick wins to money pits.', build: priorityMatrix },
  { id: 'journey', name: 'Customer journey map', category: 'strategy', description: 'Stages across, actions, thoughts and feelings down.', build: journeyMap },
];
