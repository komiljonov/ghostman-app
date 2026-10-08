// Editor groups (VS Code style): a tree of splits and groups of tabs. Pure,
// immutable functions only — unit-tested in layoutTree.test.ts. The tabs'
// state lives in the tabs controller keyed by tab key; this tree only says which
// group shows which tabs, in what order, and how the space is divided.
//
//   SplitNode  { direction, children, sizes }   sizes: fractions, sum 1
//   GroupNode  { tabs: tabKey[], activeTabId }
//
// Invariants (kept by normalize after every operation):
//   - a tab key is in at most one group;
//   - a split has >= 2 children, none of them a split in the SAME direction
//     (splitting right inside a horizontal split adds a sibling: flattened);
//   - no empty groups, except a lone root group (the empty state);
//   - sizes are positive and sum to 1;
//   - exactly one focused group, and it exists.

export type Direction = "horizontal" | "vertical"; // horizontal: side by side; vertical: stacked
export type Side = "left" | "right" | "top" | "bottom";

export interface GroupNode {
  type: "group";
  id: string;
  tabs: string[]; // tab keys, in tab-bar order
  activeTabId: string | null;
}

export interface SplitNode {
  type: "split";
  id: string;
  direction: Direction;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = GroupNode | SplitNode;

export interface Layout {
  root: LayoutNode;
  focusedGroupId: string;
}

export const MIN_GROUP_WIDTH = 200;
export const MIN_GROUP_HEIGHT = 120;

let seq = 0;
export const newId = (prefix: "g" | "s") => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const group = (id: string, tabs: string[] = [], activeTabId: string | null = tabs[0] ?? null): GroupNode =>
  ({ type: "group", id, tabs, activeTabId });

export function singleGroup(tabs: string[] = [], active: string | null = tabs[tabs.length - 1] ?? null, id = newId("g")): Layout {
  return { root: group(id, tabs, active && tabs.includes(active) ? active : tabs[0] ?? null), focusedGroupId: id };
}

// ---- Queries ----

// Groups in visual order (depth-first: left→right, top→bottom).
export function allGroups(node: LayoutNode): GroupNode[] {
  return node.type === "group" ? [node] : node.children.flatMap(allGroups);
}

export const findGroup = (node: LayoutNode, id: string) => allGroups(node).find((g) => g.id === id);
export const groupOf = (node: LayoutNode, key: string) => allGroups(node).find((g) => g.tabs.includes(key));
export const allTabs = (node: LayoutNode) => allGroups(node).flatMap((g) => g.tabs);
export const focusedGroup = (l: Layout) => findGroup(l.root, l.focusedGroupId) ?? allGroups(l.root)[0];
export const activeTab = (l: Layout) => focusedGroup(l)?.activeTabId ?? null;

export function findSplit(node: LayoutNode, id: string): SplitNode | undefined {
  if (node.type === "group") return undefined;
  if (node.id === id) return node;
  for (const c of node.children) {
    const s = findSplit(c, id);
    if (s) return s;
  }
  return undefined;
}

// ---- Normalization ----

function normalizeSizes(sizes: number[]): number[] {
  const clean = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0 || clean.some((s) => s === 0)) {
    // Missing / broken entries get an equal share of what the valid ones leave.
    const valid = clean.filter((s) => s > 0);
    if (valid.length === 0) return sizes.map(() => 1 / sizes.length);
    const share = valid.reduce((a, b) => a + b, 0) / valid.length;
    return normalizeSizes(clean.map((s) => (s > 0 ? s : share)));
  }
  return clean.map((s) => s / sum);
}

function normalizeNode(n: LayoutNode, dropEmpty: boolean): LayoutNode | null {
  if (n.type === "group") {
    if (dropEmpty && n.tabs.length === 0) return null;
    const active = n.activeTabId && n.tabs.includes(n.activeTabId) ? n.activeTabId : n.tabs[0] ?? null;
    return active === n.activeTabId ? n : { ...n, activeTabId: active };
  }
  const sizes = n.sizes.length === n.children.length ? n.sizes : n.children.map(() => 1);
  const own = normalizeSizes(sizes);
  const kids: LayoutNode[] = [];
  const kidSizes: number[] = [];
  n.children.forEach((c, i) => {
    const k = normalizeNode(c, dropEmpty);
    if (!k) return;
    if (k.type === "split" && k.direction === n.direction) {
      // Same direction nested: flatten into this split (VS Code does the same).
      k.children.forEach((gc, j) => {
        kids.push(gc);
        kidSizes.push(own[i] * k.sizes[j]);
      });
    } else {
      kids.push(k);
      kidSizes.push(own[i]);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  return { ...n, children: kids, sizes: normalizeSizes(kidSizes) };
}

// Restores every invariant. `fallbackFocus` is used when the focused group is gone.
export function normalize(l: Layout, fallbackFocus?: string): Layout {
  const root = normalizeNode(l.root, true) ?? group(allGroups(l.root)[0]?.id ?? newId("g"));
  const ids = allGroups(root).map((g) => g.id);
  const focus = ids.includes(l.focusedGroupId) ? l.focusedGroupId
    : fallbackFocus && ids.includes(fallbackFocus) ? fallbackFocus : ids[0];
  return { root, focusedGroupId: focus };
}

// ---- Transforms (internal) ----

function mapGroups(node: LayoutNode, fn: (g: GroupNode) => GroupNode): LayoutNode {
  if (node.type === "group") return fn(node);
  return { ...node, children: node.children.map((c) => mapGroups(c, fn)) };
}

// Removes a key from its group, picking the neighbor as the new active tab.
function withoutTab(g: GroupNode, key: string): GroupNode {
  const i = g.tabs.indexOf(key);
  if (i < 0) return g;
  const tabs = g.tabs.filter((k) => k !== key);
  const active = g.activeTabId === key ? tabs[i] ?? tabs[i - 1] ?? null : g.activeTabId;
  return { ...g, tabs, activeTabId: active };
}

const stripTab = (node: LayoutNode, key: string) => mapGroups(node, (g) => withoutTab(g, key));

// The group that takes over the focus when `id` disappears: its neighbor in visual order.
function neighborOf(node: LayoutNode, id: string): string | undefined {
  const ids = allGroups(node).map((g) => g.id);
  const i = ids.indexOf(id);
  return i < 0 ? undefined : ids[i - 1] ?? ids[i + 1];
}

// Moves the item at `from` to insertion slot `slot` (slots between ORIGINAL positions).
function reorder<T>(list: T[], from: number, slot: number): T[] {
  const s = Math.max(0, Math.min(slot, list.length));
  if (from < 0 || from >= list.length || s === from || s === from + 1) return list;
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(s > from ? s - 1 : s, 0, item);
  return out;
}

// ---- Operations ----

// Focuses a group (keeps everything else).
export const focusGroup = (l: Layout, id: string): Layout => (findGroup(l.root, id) ? { ...l, focusedGroupId: id } : l);

// Activates a tab in its group and focuses that group.
export function activateTab(l: Layout, key: string): Layout {
  const g = groupOf(l.root, key);
  if (!g) return l;
  return { root: mapGroups(l.root, (x) => (x.id === g.id ? { ...x, activeTabId: key } : x)), focusedGroupId: g.id };
}

// Opens a tab: an already open tab is revealed where it is; a new one goes to the
// focused group (after its active tab, like VS Code) and becomes active there.
export function openTab(l: Layout, key: string): Layout {
  if (groupOf(l.root, key)) return activateTab(l, key);
  const target = focusedGroup(l);
  const root = mapGroups(l.root, (g) => {
    if (g.id !== target.id) return g;
    const at = g.activeTabId ? g.tabs.indexOf(g.activeTabId) + 1 : g.tabs.length;
    const tabs = [...g.tabs.slice(0, at), key, ...g.tabs.slice(at)];
    return { ...g, tabs, activeTabId: key };
  });
  return { root, focusedGroupId: target.id };
}

// Closes a tab. An emptied group disappears (its split collapses); the focus moves
// to its neighbor.
export function closeTab(l: Layout, key: string): Layout {
  const g = groupOf(l.root, key);
  if (!g) return l;
  const fallback = g.tabs.length === 1 ? neighborOf(l.root, g.id) : undefined;
  return normalize({ ...l, root: stripTab(l.root, key) }, fallback);
}

// Moves a tab into `targetId` at insertion slot `index` (end when omitted) and
// activates it there. Within one group this is a reorder.
export function moveTab(l: Layout, key: string, targetId: string, index?: number): Layout {
  const src = groupOf(l.root, key);
  const target = findGroup(l.root, targetId);
  if (!src || !target) return l;
  if (src.id === targetId) {
    const from = src.tabs.indexOf(key);
    const tabs = index === undefined ? src.tabs : reorder(src.tabs, from, index);
    const root = mapGroups(l.root, (g) => (g.id === targetId ? { ...g, tabs, activeTabId: key } : g));
    return { root, focusedGroupId: targetId };
  }
  const stripped = stripTab(l.root, key);
  const root = mapGroups(stripped, (g) => {
    if (g.id !== targetId) return g;
    const at = index === undefined ? g.tabs.length : Math.max(0, Math.min(index, g.tabs.length));
    return { ...g, tabs: [...g.tabs.slice(0, at), key, ...g.tabs.slice(at)], activeTabId: key };
  });
  return normalize({ root, focusedGroupId: targetId });
}

const directionOf = (side: Side): Direction => (side === "left" || side === "right" ? "horizontal" : "vertical");
const before = (side: Side) => side === "left" || side === "top";

function insertBeside(node: LayoutNode, targetId: string, side: Side, fresh: GroupNode): LayoutNode {
  const dir = directionOf(side);
  if (node.type === "group") {
    if (node.id !== targetId) return node;
    return {
      type: "split", id: newId("s"), direction: dir,
      children: before(side) ? [fresh, node] : [node, fresh], sizes: [0.5, 0.5],
    };
  }
  const i = node.children.findIndex((c) => c.type === "group" && c.id === targetId);
  if (i >= 0 && node.direction === dir) {
    // Same direction: a sibling, sharing the target's space 50/50 (flat, not nested).
    const half = node.sizes[i] / 2;
    const at = before(side) ? i : i + 1;
    const children = [...node.children];
    children.splice(at, 0, fresh);
    const sizes = [...node.sizes];
    sizes.splice(i, 1, half);
    sizes.splice(at, 0, half);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => insertBeside(c, targetId, side, fresh)) };
}

// Splits `targetId` on `side` with a new group holding `key` (moved out of its
// current group). The target's space is shared 50/50.
// The ONLY tab of a group split off its own group: in VS Code the vacated group
// closes (closeEmptyGroups) and the result is the very same layout — here that
// is exactly what you get (unchanged, not resized), see isOwnSoleTab.
export function splitGroup(l: Layout, targetId: string, side: Side, key: string, freshId = newId("g")): Layout {
  if (!findGroup(l.root, targetId) || !groupOf(l.root, key)) return l;
  if (isOwnSoleTab(l, key, targetId)) return focusGroup(l, targetId);
  const fresh = group(freshId, [key], key);
  const root = insertBeside(stripTab(l.root, key), targetId, side, fresh);
  return normalize({ root, focusedGroupId: freshId });
}

// Whether `key` is the only tab of `groupId` (splitting it off its own group
// changes nothing: the vacated group would close).
export function isOwnSoleTab(l: Layout, key: string, groupId: string): boolean {
  const g = findGroup(l.root, groupId);
  return !!g && g.tabs.length === 1 && g.tabs[0] === key;
}

// Removes a group outright (its tabs go with it); siblings share its space
// proportionally and a split left with one child collapses into it.
export function removeGroup(l: Layout, id: string): Layout {
  if (!findGroup(l.root, id)) return l;
  const fallback = neighborOf(l.root, id);
  const emptied = mapGroups(l.root, (g) => (g.id === id ? { ...g, tabs: [], activeTabId: null } : g));
  return normalize({ ...l, root: emptied }, fallback);
}

// Drops every tab `keep` rejects (restore: gone requests), then normalizes.
export function pruneTabs(l: Layout, keep: (key: string) => boolean): Layout {
  const root = mapGroups(l.root, (g) => {
    const tabs = g.tabs.filter(keep);
    return tabs.length === g.tabs.length ? g : { ...g, tabs, activeTabId: g.activeTabId && keep(g.activeTabId) ? g.activeTabId : null };
  });
  return normalize({ ...l, root });
}

function mapSplit(node: LayoutNode, id: string, fn: (s: SplitNode) => SplitNode): LayoutNode {
  if (node.type === "group") return node;
  if (node.id === id) return fn(node);
  return { ...node, children: node.children.map((c) => mapSplit(c, id, fn)) };
}

// Moves the boundary after child `index` of split `splitId` by `delta` (a fraction
// of the split's length), keeping both neighbors at or above their minimum
// fractions (`mins`, per child).
export function resize(l: Layout, splitId: string, index: number, delta: number, mins: number[]): Layout {
  const root = mapSplit(l.root, splitId, (s) => {
    if (index < 0 || index >= s.children.length - 1) return s;
    const a = s.sizes[index];
    const b = s.sizes[index + 1];
    const minA = mins[index] ?? 0;
    const minB = mins[index + 1] ?? 0;
    if (minA + minB > a + b) return s; // no room to move at all
    const d = Math.max(minA - a, Math.min(delta, b - minB));
    if (d === 0) return s;
    const sizes = [...s.sizes];
    sizes[index] = a + d;
    sizes[index + 1] = b - d;
    return { ...s, sizes };
  });
  return { ...l, root };
}

// Double-click on a sash: equal sizes for that split.
export const resetSizes = (l: Layout, splitId: string): Layout => ({
  ...l, root: mapSplit(l.root, splitId, (s) => ({ ...s, sizes: s.children.map(() => 1 / s.children.length) })),
});

// The side a group grows in from when it first appears (split animation): the
// side of its parent split it sits on, relative to its siblings.
export function entrySide(root: LayoutNode, id: string): Side | null {
  const walk = (n: LayoutNode): Side | null => {
    if (n.type === "group") return null;
    const i = n.children.findIndex((c) => c.type === "group" && c.id === id);
    if (i >= 0) {
      const first = i === 0;
      return n.direction === "horizontal" ? (first ? "left" : "right") : (first ? "top" : "bottom");
    }
    for (const c of n.children) {
      const s = walk(c);
      if (s) return s;
    }
    return null;
  };
  return walk(root);
}

// ---- Geometry ----

export interface Rect {
  x: number; // fractions of the editor area
  y: number;
  w: number;
  h: number;
}

export interface GroupRect extends Rect {
  id: string;
}

export interface SashRect extends Rect {
  splitId: string;
  index: number; // the boundary after child `index`
  direction: Direction; // the split's direction (horizontal → a vertical sash line)
  split: Rect; // the whole split's area (for resizing)
}

export function layoutRects(root: LayoutNode): { groups: GroupRect[]; sashes: SashRect[] } {
  const groups: GroupRect[] = [];
  const sashes: SashRect[] = [];
  const walk = (n: LayoutNode, r: Rect) => {
    if (n.type === "group") {
      groups.push({ id: n.id, ...r });
      return;
    }
    let offset = 0;
    n.children.forEach((c, i) => {
      const s = n.sizes[i];
      const child = n.direction === "horizontal"
        ? { x: r.x + offset * r.w, y: r.y, w: s * r.w, h: r.h }
        : { x: r.x, y: r.y + offset * r.h, w: r.w, h: s * r.h };
      walk(c, child);
      offset += s;
      if (i < n.children.length - 1) {
        sashes.push(n.direction === "horizontal"
          ? { splitId: n.id, index: i, direction: n.direction, x: r.x + offset * r.w, y: r.y, w: 0, h: r.h, split: r }
          : { splitId: n.id, index: i, direction: n.direction, x: r.x, y: r.y + offset * r.h, w: r.w, h: 0, split: r });
      }
    });
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 });
  return { groups, sashes };
}

// Minimum size of a subtree in px: groups need MIN_GROUP_*; a split needs the sum
// of its children along its direction and the largest across it.
export function minSize(n: LayoutNode): { w: number; h: number } {
  if (n.type === "group") return { w: MIN_GROUP_WIDTH, h: MIN_GROUP_HEIGHT };
  const kids = n.children.map(minSize);
  return n.direction === "horizontal"
    ? { w: kids.reduce((a, k) => a + k.w, 0), h: Math.max(...kids.map((k) => k.h)) }
    : { w: Math.max(...kids.map((k) => k.w)), h: kids.reduce((a, k) => a + k.h, 0) };
}

// The children's minimum fractions of a split whose area is `px` long.
export function minFractions(s: SplitNode, px: number): number[] {
  return s.children.map((c) => {
    const m = minSize(c);
    return (s.direction === "horizontal" ? m.w : m.h) / Math.max(px, 1);
  });
}

// Raises sizes below the minimums (restore, or a window that grew/shrank),
// taking the difference from the children with room to spare. When the area is
// simply too small for everyone, sizes become equal.
export function enforceMinimums(l: Layout, widthPx: number, heightPx: number): Layout {
  const fix = (n: LayoutNode, w: number, h: number): LayoutNode => {
    if (n.type === "group") return n;
    const length = n.direction === "horizontal" ? w : h;
    const mins = minFractions(n, length);
    let sizes = [...n.sizes];
    if (mins.reduce((a, b) => a + b, 0) > 1) {
      sizes = sizes.map(() => 1 / sizes.length);
    } else {
      const EPS = 1e-6; // a size exactly at its minimum is not "below" it
      const deficit = sizes.reduce((a, s, i) => a + (s < mins[i] - EPS ? mins[i] - s : 0), 0);
      if (deficit > 0) {
        const spare = sizes.map((s, i) => Math.max(0, s - mins[i]));
        const totalSpare = spare.reduce((a, b) => a + b, 0);
        sizes = sizes.map((s, i) => (s < mins[i] - EPS ? mins[i] : s - (spare[i] / totalSpare) * deficit));
      }
    }
    const children = n.children.map((c, i) =>
      fix(c, n.direction === "horizontal" ? w * sizes[i] : w, n.direction === "vertical" ? h * sizes[i] : h));
    return { ...n, sizes, children };
  };
  return { ...l, root: fix(l.root, widthPx, heightPx) };
}

// ---- Persistence (versioned JSON) ----

export const LAYOUT_VERSION = 1;

export interface SavedLayout {
  version: number;
  layout: Layout;
}

export const serializeLayout = (l: Layout): SavedLayout => ({ version: LAYOUT_VERSION, layout: l });

// Validates stored data. Anything unreadable gives null (the caller falls back to
// a single empty group). Unknown tab keys (`isTabKey`), duplicate tabs (first
// wins), duplicate / missing ids, bad sizes and empty groups are repaired.
export function parseLayout(raw: unknown, isTabKey: (key: string) => boolean): Layout | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as { version?: unknown; layout?: unknown };
  if (doc.version !== LAYOUT_VERSION || !doc.layout || typeof doc.layout !== "object") return null;
  const lay = doc.layout as { root?: unknown; focusedGroupId?: unknown };
  const seenTabs = new Set<string>();
  const seenIds = new Set<string>();
  const freshId = (id: unknown, prefix: "g" | "s") => {
    const ok = typeof id === "string" && id !== "" && id.length <= 64 && !seenIds.has(id);
    const out = ok ? (id as string) : newId(prefix);
    seenIds.add(out);
    return out;
  };
  const parse = (n: unknown, depth: number): LayoutNode | null => {
    if (!n || typeof n !== "object" || depth > 32) return null;
    const o = n as Record<string, unknown>;
    if (o.type === "group") {
      const tabs: string[] = [];
      for (const k of Array.isArray(o.tabs) ? o.tabs : []) {
        if (typeof k !== "string" || !isTabKey(k) || seenTabs.has(k)) continue; // first occurrence wins
        seenTabs.add(k);
        tabs.push(k);
      }
      const active = typeof o.activeTabId === "string" && tabs.includes(o.activeTabId) ? o.activeTabId : tabs[0] ?? null;
      return group(freshId(o.id, "g"), tabs, active);
    }
    if (o.type === "split" && (o.direction === "horizontal" || o.direction === "vertical") && Array.isArray(o.children)) {
      const pairs = o.children.map((c, i) => ({
        node: parse(c, depth + 1),
        size: Array.isArray(o.sizes) && typeof o.sizes[i] === "number" ? (o.sizes[i] as number) : NaN,
      })).filter((p): p is { node: LayoutNode; size: number } => p.node !== null);
      if (pairs.length === 0) return null;
      return {
        type: "split", id: freshId(o.id, "s"), direction: o.direction,
        children: pairs.map((p) => p.node), sizes: pairs.map((p) => p.size),
      };
    }
    return null;
  };
  const root = parse(lay.root, 0);
  if (!root) return null;
  return normalize({ root, focusedGroupId: typeof lay.focusedGroupId === "string" ? lay.focusedGroupId : "" });
}
