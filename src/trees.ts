import type { Connector, Item, Side, TreeLayout } from './types';

/**
 * Mind maps and trees (org charts). Pure: no React, no store.
 *
 * A tree is ordinary items: the root has `tree.layout`, every other node
 * `tree.parent`. Branch lines are ordinary connectors marked `branch`. The
 * layout places every node from the root outward; sibling order comes from
 * where the nodes are (top to bottom, or left to right in an org chart), so
 * dragging a node past its siblings reorders it, like slides in a deck.
 */

type Items = Record<string, Item>;
type Vec = { x: number; y: number };

/** Space between a node and its children (across) and between siblings (along). */
export const TREE_GAP = {
  mind: { across: 70, along: 18 },
  org: { across: 70, along: 30 },
};

/** Colors of a mind map's main branches, in turn; their children use the same color. */
export const BRANCH_COLORS = ['#2F6FED', '#2BA84A', '#8E44D9', '#F28C28', '#E5383B', '#0FA3B1'];

export const isTreeNode = (it: Item | undefined): it is Item => !!it?.tree;
export const isTreeRoot = (it: Item | undefined): it is Item => !!it?.tree && !it.tree.parent;
export const treeLayoutOf = (root: Item | undefined): TreeLayout => root?.tree?.layout ?? 'mind';

const kidsCache = new WeakMap<Items, Map<string, string[]>>();

/** Child ids of every tree node (parent id → children), worked out once per items object. */
export function treeChildren(items: Items): Map<string, string[]> {
  let m = kidsCache.get(items);
  if (m) return m;
  m = new Map();
  for (const id in items) {
    const p = items[id].tree?.parent;
    if (!p || !items[p]?.tree) continue;
    const list = m.get(p);
    if (list) list.push(id);
    else m.set(p, [id]);
  }
  kidsCache.set(items, m);
  return m;
}

/** The root of the tree `id` belongs to (null if it isn't a tree node, or its parents loop). */
export function treeRootOf(items: Items, id: string): string | null {
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && items[cur]?.tree) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const p: string | undefined = items[cur].tree!.parent;
    if (!p || !items[p]?.tree) return cur;
    cur = p;
  }
  return null;
}

/** Every node below the given ones (not including them). */
export function treeDescendants(items: Items, ids: Iterable<string>): string[] {
  const kids = treeChildren(items);
  const out: string[] = [];
  const seen = new Set<string>(ids);
  const stack = [...seen];
  while (stack.length) {
    for (const k of kids.get(stack.pop()!) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
      stack.push(k);
    }
  }
  return out;
}

/** `ids` plus every tree node below them (moving, copying or deleting a node takes its branch). */
export const withTreeChildren = (ids: string[], items: Items): string[] => [...ids, ...treeDescendants(items, ids)];

const hiddenCache = new WeakMap<Items, Set<string>>();

/** Nodes folded away inside a collapsed branch (not drawn, not exported, not selectable). */
export function collapsedHidden(items: Items): Set<string> {
  let h = hiddenCache.get(items);
  if (h) return h;
  const folded: string[] = [];
  for (const id in items) if (items[id].tree?.collapsed) folded.push(id);
  h = new Set(folded.length ? treeDescendants(items, folded) : []);
  hiddenCache.set(items, h);
  return h;
}

const centerOf = (b: { x: number; y: number; w: number; h: number }): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * Which way a node's branch grows: 'right' / 'left' (mind map: a main branch
 * goes to the side its node is on; nodes below follow it) or 'down' (org chart).
 */
export function nodeSide(items: Items, id: string): 'right' | 'left' | 'down' {
  const rootId = treeRootOf(items, id);
  const root = rootId ? items[rootId] : undefined;
  const layout = treeLayoutOf(root);
  if (layout === 'org') return 'down';
  if (layout === 'right' || !root || rootId === id) return 'right';
  // Walk up to the main branch (the child of the root).
  let cur = id;
  for (let i = 0; i < 1000; i++) {
    const p = items[cur]?.tree?.parent;
    if (!p || p === rootId) break;
    cur = p;
  }
  return centerOf(items[cur]).x < centerOf(root).x ? 'left' : 'right';
}

export interface TreePatch {
  items: Record<string, Partial<Item>>;
  connectors: Record<string, Partial<Connector>>;
}

/**
 * Lay out one tree from its root (which stays where it is). Returns only what
 * changes: node positions, and branch lines' style and sides (curved from the
 * side facing the child in a mind map; elbow, bottom to top, in an org chart).
 * Nodes inside a collapsed branch keep their place.
 */
export function layoutTree(rootId: string, items: Items, connectors: Record<string, Connector>): TreePatch {
  const out: TreePatch = { items: {}, connectors: {} };
  const root = items[rootId];
  if (!root?.tree) return out;
  const layout = treeLayoutOf(root);
  const kidsAll = treeChildren(items);
  const pos = new Map<string, Vec>();
  const box = (id: string) => {
    const it = items[id];
    const p = pos.get(id);
    return p ? { ...it, x: p.x, y: p.y } : it;
  };
  const seen = new Set<string>([rootId]);
  const kids = (id: string) =>
    items[id].tree?.collapsed ? [] : (kidsAll.get(id) ?? []).filter((k) => items[k] && !seen.has(k));
  const sideOf = new Map<string, 1 | -1>();

  if (layout === 'org') {
    const gap = TREE_GAP.org;
    const widthMemo = new Map<string, number>();
    const byX = (ids: string[]) => [...ids].sort((a, b) => centerOf(items[a]).x - centerOf(items[b]).x);
    const width = (id: string, path: Set<string>): number => {
      const memo = widthMemo.get(id);
      if (memo !== undefined) return memo;
      const ks = kids(id).filter((k) => !path.has(k));
      const next = new Set(path).add(id);
      const sum = ks.reduce((s, k) => s + width(k, next), 0) + gap.along * Math.max(ks.length - 1, 0);
      const w = Math.max(items[id].w, sum);
      widthMemo.set(id, w);
      return w;
    };
    const place = (id: string) => {
      const node = box(id);
      const ks = byX(kids(id));
      ks.forEach((k) => seen.add(k));
      const total = ks.reduce((s, k) => s + width(k, new Set([id])), 0) + gap.along * Math.max(ks.length - 1, 0);
      let x = node.x + node.w / 2 - total / 2;
      for (const k of ks) {
        const w = width(k, new Set([id]));
        pos.set(k, { x: x + w / 2 - items[k].w / 2, y: node.y + node.h + gap.across });
        x += w + gap.along;
      }
      ks.forEach(place);
    };
    place(rootId);
  } else {
    const gap = TREE_GAP.mind;
    const heightMemo = new Map<string, number>();
    const byY = (ids: string[]) => [...ids].sort((a, b) => centerOf(items[a]).y - centerOf(items[b]).y);
    const height = (id: string, path: Set<string>): number => {
      const memo = heightMemo.get(id);
      if (memo !== undefined) return memo;
      const ks = kids(id).filter((k) => !path.has(k));
      const next = new Set(path).add(id);
      const sum = ks.reduce((s, k) => s + height(k, next), 0) + gap.along * Math.max(ks.length - 1, 0);
      const h = Math.max(items[id].h, sum);
      heightMemo.set(id, h);
      return h;
    };
    // Stack `ks` beside `id` on one side, centred on it, then their children.
    const placeGroup = (id: string, ks: string[], side: 1 | -1) => {
      const node = box(id);
      ks = byY(ks);
      ks.forEach((k) => seen.add(k));
      const total = ks.reduce((s, k) => s + height(k, new Set([id])), 0) + gap.along * Math.max(ks.length - 1, 0);
      let y = node.y + node.h / 2 - total / 2;
      for (const k of ks) {
        const h = height(k, new Set([id]));
        const w = items[k].w;
        pos.set(k, { x: side > 0 ? node.x + node.w + gap.across : node.x - gap.across - w, y: y + h / 2 - items[k].h / 2 });
        sideOf.set(k, side);
        y += h + gap.along;
      }
      for (const k of ks) placeGroup(k, kids(k), side);
    };
    const first = kids(rootId);
    const rc = centerOf(root).x;
    const left = layout === 'mind' ? first.filter((k) => centerOf(items[k]).x < rc) : [];
    const right = first.filter((k) => !left.includes(k));
    placeGroup(rootId, right, 1);
    placeGroup(rootId, left, -1);
  }

  for (const [id, p] of pos) {
    const it = items[id];
    if (Math.abs(it.x - p.x) > 0.5 || Math.abs(it.y - p.y) > 0.5) out.items[id] = { x: p.x, y: p.y };
  }

  // Branch lines: the right look for this layout and side.
  const inTree = new Set(pos.keys());
  for (const c of Object.values(connectors)) {
    if (!c.branch || c.to.kind !== 'item' || c.from.kind !== 'item' || !inTree.has(c.to.itemId)) continue;
    const side = sideOf.get(c.to.itemId) ?? 1;
    const want: { style: Connector['style']; from: Side; to: Side } =
      layout === 'org'
        ? { style: 'elbow', from: 'bottom', to: 'top' }
        : { style: 'curved', from: side > 0 ? 'right' : 'left', to: side > 0 ? 'left' : 'right' };
    if (c.style !== want.style || c.from.side !== want.from || c.to.side !== want.to) {
      out.connectors[c.id] = {
        style: want.style,
        from: { ...c.from, side: want.from },
        to: { ...c.to, side: want.to },
        bends: null,
        channel: null,
      };
    }
  }
  return out;
}

/**
 * Copied or inserted items with new ids (`idMap`: old → new): point `tree.parent`
 * at the new ids. A node whose parent wasn't copied becomes the root of a new
 * mind map (copying a branch gives a map of its own).
 */
export function remapTrees(items: Item[], idMap: Map<string, string>): Item[] {
  return items.map((it) => {
    if (!it.tree?.parent) return it;
    const parent = idMap.get(it.tree.parent);
    if (parent) return { ...it, tree: { ...it.tree, parent } };
    const tree = { ...it.tree, layout: it.tree.layout ?? ('mind' as const) };
    delete tree.parent;
    return { ...it, tree };
  });
}
