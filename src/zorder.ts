/**
 * Z-order for shared editing. In the board document every item stores a number,
 * `z`; the board's `order` is the items sorted by z, ties broken by id so every
 * copy of the board sorts the same way. A shared list of ids would break when two
 * people reorder at the same time, while numbers on the items just merge.
 *
 * When the local order changes, only the items that moved get a new z: the
 * longest run of items whose z is already in order stays as it is, the others
 * get numbers between their neighbors. Bring to front changes one item, not all.
 */

/** Ids sorted by z (lowest first), ties broken by id. */
export function sortByZ(ids: string[], z: (id: string) => number): string[] {
  return [...ids].sort((a, b) => z(a) - z(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * New z values that make `order` strictly increasing, changing as few items as
 * possible. `current` gives each item's z (undefined for new items). Returns only
 * the items whose z changes.
 */
export function assignZ(order: string[], current: (id: string) => number | undefined): Map<string, number> {
  const n = order.length;
  const zs = order.map((id) => {
    const z = current(id);
    return z !== undefined && Number.isFinite(z) ? z : undefined;
  });
  const keep = longestIncreasing(zs);
  const out = new Map<string, number>();
  for (let i = 0; i < n; ) {
    if (keep[i]) {
      i++;
      continue;
    }
    // A run of items to renumber, between two kept neighbors (or the ends).
    let j = i;
    while (j < n && !keep[j]) j++;
    const lo = i > 0 ? zs[i - 1] : undefined;
    const hi = j < n ? zs[j] : undefined;
    const k = j - i;
    for (let m = 0; m < k; m++) {
      let v: number;
      if (lo === undefined && hi === undefined) v = m + 1;
      else if (lo === undefined) v = hi! - (k - m);
      else if (hi === undefined) v = lo + m + 1;
      else v = lo + ((hi - lo) * (m + 1)) / (k + 1);
      out.set(order[i + m], v);
    }
    i = j;
  }
  // Numbers too close together to fit another one between: renumber everything.
  const z = (id: string, idx: number) => out.get(id) ?? zs[idx]!;
  for (let i = 1; i < n; i++) {
    if (!(z(order[i], i) > z(order[i - 1], i - 1))) {
      out.clear();
      order.forEach((id, idx) => {
        if (zs[idx] !== idx + 1) out.set(id, idx + 1);
      });
      break;
    }
  }
  return out;
}

/** Which entries form the longest strictly increasing run (undefined entries never do). */
function longestIncreasing(zs: (number | undefined)[]): boolean[] {
  const tails: number[] = []; // tails[len] = index of the smallest last value of a run of length len + 1
  const prev = new Array<number>(zs.length).fill(-1);
  for (let i = 0; i < zs.length; i++) {
    const v = zs[i];
    if (v === undefined) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (zs[tails[mid]]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Array<boolean>(zs.length).fill(false);
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep[i] = true;
  return keep;
}
