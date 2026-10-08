// Tab drag & drop between editor groups (VS Code style): what the pointer is
// over, what the drop preview looks like, and what a drop does. Pure — tested in
// dropZone.test.ts; the pointer wiring is EditorGroups.tsx.
//
// Hit-testing works on rects captured when the drag starts (the layout does not
// change while dragging), evaluated once per animation frame:
//   over a group's tab bar   → insert at a position (vertical insertion line)
//   over a group's content   → one of 5 zones: the outer EDGE fraction of each
//                              side splits there, the middle appends the tab
import { dropSlot } from "./tabModel";
import { groupOf, isOwnSoleTab, Layout, moveTab, Side, splitGroup } from "./layoutTree";

export type Zone = "center" | Side;

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GroupHit {
  id: string;
  bar: PxRect; // the group's tab bar
  content: PxRect; // the group's editor area
  tabs: PxRect[]; // its tabs, in order
}

export type DropTarget =
  | { kind: "bar"; groupId: string; index: number }
  | { kind: "zone"; groupId: string; zone: Zone };

export const EDGE = 0.33; // like VS Code: about the outer third of each side

const inside = (r: PxRect, x: number, y: number) =>
  x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;

// The zone under the pointer: the nearest edge band it is in, else the center.
export function zoneAt(r: PxRect, x: number, y: number, edge = EDGE): Zone {
  const fx = (x - r.left) / r.width;
  const fy = (y - r.top) / r.height;
  const bands: [Side, number][] = [
    ["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy],
  ];
  let best: Zone = "center";
  let nearest = edge;
  for (const [side, d] of bands) {
    if (d < nearest) {
      nearest = d;
      best = side;
    }
  }
  return best;
}

export function hitTest(groups: GroupHit[], x: number, y: number): DropTarget | null {
  for (const g of groups) {
    if (inside(g.bar, x, y)) {
      const rects = g.tabs.map((t) => ({ left: t.left, right: t.left + t.width }));
      return { kind: "bar", groupId: g.id, index: dropSlot(x, rects) };
    }
    if (inside(g.content, x, y)) return { kind: "zone", groupId: g.id, zone: zoneAt(g.content, x, y) };
  }
  return null; // outside every target: a drop here cancels
}

// The drop preview over a group's content: all of it for the center, the half on
// that side for an edge (what the new group will occupy).
export function overlayRect(r: PxRect, zone: Zone): PxRect {
  switch (zone) {
    case "left":
      return { ...r, width: r.width / 2 };
    case "right":
      return { ...r, left: r.left + r.width / 2, width: r.width / 2 };
    case "top":
      return { ...r, height: r.height / 2 };
    case "bottom":
      return { ...r, top: r.top + r.height / 2, height: r.height / 2 };
    default:
      return r;
  }
}

// Where the insertion line goes in a tab bar: before tab `index`, or after the last.
export function insertionX(g: GroupHit, index: number): number {
  if (g.tabs.length === 0) return g.bar.left + 4;
  if (index < g.tabs.length) return g.tabs[index].left;
  const last = g.tabs[g.tabs.length - 1];
  return last.left + last.width;
}

// Whether a target would change nothing (no preview, the drop is a no-op).
export function isNoop(l: Layout, key: string, t: DropTarget): boolean {
  const src = groupOf(l.root, key);
  if (!src) return true;
  if (t.groupId !== src.id) return false;
  // Own center: nothing to do. The group's only tab on its own edge: the same
  // layout as now (VS Code closes the vacated group), so no preview either.
  if (t.kind === "zone") return t.zone === "center" || isOwnSoleTab(l, key, src.id);
  const from = src.tabs.indexOf(key);
  return t.index === from || t.index === from + 1; // dropped onto itself
}

// The layout after dropping `key` on `t`; null = a no-op.
export function applyDrop(l: Layout, key: string, t: DropTarget, freshId?: string): Layout | null {
  if (isNoop(l, key, t)) return null;
  if (t.kind === "bar") return moveTab(l, key, t.groupId, t.index);
  if (t.zone === "center") return moveTab(l, key, t.groupId); // append + activate
  return splitGroup(l, t.groupId, t.zone, key, freshId);
}
