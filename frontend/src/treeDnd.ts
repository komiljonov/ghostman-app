// Drag-and-drop model of the sidebar tree: where a drop lands and what it does.
// Pure functions over the tree and the rows' geometry, so they are unit-testable;
// treeDrag.ts wires them to pointer events.
//
// Zones of the row under the pointer:
//   folder   top 25% → before it · (collapsed only) bottom 25% → after it · else → INTO it (at the end)
//   request  top half → before it · bottom half → after it
//   below the last row → the end of the project root
// Folders and requests are ordered separately (folders first in each folder), so an
// insert lands among the dragged kind's siblings: a request "before a folder" goes
// to the start of the requests, a folder "after a request" to the end of the folders.
// A folder can never be dropped into itself or its subtree (no target at all there).
import type { Tree, TreeNode } from "./tree";

export type NodeKind = "folder" | "request";

export interface Dragged {
  id: string;
  kind: NodeKind;
}

// One visible row, in screen order, with its geometry (viewport px).
export interface DndRow {
  id: string;
  kind: NodeKind;
  parentId: string | null;
  depth: number;
  expanded: boolean;
  rowTop: number; // the row itself
  rowBottom: number;
  blockTop: number; // the row plus its visible subtree (its <li>)
  blockBottom: number;
}

export type Drop =
  | { type: "into"; folderId: string }
  | { type: "insert"; parentId: string | null; index: number; lineY: number; depth: number };

export function parentOf(tree: Tree, node: Dragged): string | null {
  return node.kind === "folder" ? tree.folders.get(node.id)?.parentId ?? null : tree.requests.get(node.id)?.folderId ?? null;
}

const childrenOf = (tree: Tree, parentId: string | null): TreeNode[] =>
  parentId === null ? tree.root : tree.folders.get(parentId)?.children ?? [];

// Same-kind children of a parent, in order (optionally without one id).
export function siblingIds(tree: Tree, parentId: string | null, kind: NodeKind, without?: string): string[] {
  return childrenOf(tree, parentId).filter((n) => n.kind === kind && n.id !== without).map((n) => n.id);
}

// Whether node is folderId itself or anywhere inside it.
export function isInSubtree(tree: Tree, folderId: string, node: Dragged): boolean {
  let id: string | null = node.id;
  let kind: NodeKind = node.kind;
  for (let guard = 0; id !== null && guard < 10_000; guard++) {
    if (kind === "folder" && id === folderId) return true;
    id = parentOf(tree, { id, kind });
    kind = "folder";
  }
  return false;
}

// Insert among the dragged kind's siblings of parentId at index; works out the y
// of the insertion line from the rows' blocks.
function insertAt(rows: DndRow[], tree: Tree, dragged: Dragged, parentId: string | null, index: number, depth: number): Drop {
  const sib = siblingIds(tree, parentId, dragged.kind, dragged.id);
  const block = (id: string | undefined) => rows.find((r) => r.id === id);
  let lineY: number | undefined;
  if (index < sib.length) lineY = block(sib[index])?.blockTop;
  else if (sib.length > 0) lineY = block(sib[sib.length - 1])?.blockBottom;
  else {
    // No same-kind siblings: requests go after the folders, folders before the requests.
    const others = siblingIds(tree, parentId, dragged.kind === "folder" ? "request" : "folder", dragged.id);
    lineY = dragged.kind === "request" ? block(others[others.length - 1])?.blockBottom : block(others[0])?.blockTop;
  }
  if (lineY === undefined) {
    const last = rows[rows.length - 1];
    lineY = last ? last.blockBottom : 0;
  }
  return { type: "insert", parentId, index, lineY, depth };
}

export function computeDrop(rows: DndRow[], tree: Tree, dragged: Dragged, y: number): Drop | null {
  const r = rows.find((row) => y >= row.rowTop && y < row.rowBottom);
  if (!r) {
    const last = rows[rows.length - 1];
    if (!last || y >= last.blockBottom) {
      return insertAt(rows, tree, dragged, null, siblingIds(tree, null, dragged.kind, dragged.id).length, 0);
    }
    return null;
  }
  if (r.id === dragged.id) return null;
  if (dragged.kind === "folder" && isInSubtree(tree, dragged.id, r)) return null;

  const f = (y - r.rowTop) / Math.max(1, r.rowBottom - r.rowTop);
  let edge: "before" | "after";
  if (r.kind === "folder") {
    if (f < 0.25) edge = "before";
    else if (!r.expanded && f >= 0.75) edge = "after";
    else return { type: "into", folderId: r.id };
  } else {
    edge = f < 0.5 ? "before" : "after";
  }

  const sib = siblingIds(tree, r.parentId, dragged.kind, dragged.id);
  let index: number;
  if (r.kind === dragged.kind) {
    const pos = sib.indexOf(r.id);
    index = edge === "before" ? pos : pos + 1;
  } else {
    index = dragged.kind === "request" ? 0 : sib.length;
  }
  return insertAt(rows, tree, dragged, r.parentId, index, r.depth);
}

// What to send for a drop (PlaceNode's arguments; "" = root), or null when the
// drop would leave everything as it is.
export interface PlaceArgs {
  currentParentId: string;
  targetParentId: string;
  orderedIds: string[] | null; // null: append wherever the move puts it
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function placement(tree: Tree, dragged: Dragged, drop: Drop): PlaceArgs | null {
  const current = parentOf(tree, dragged);
  const currentOrder = siblingIds(tree, current, dragged.kind);
  if (drop.type === "into") {
    if (drop.folderId !== current) {
      return { currentParentId: current ?? "", targetParentId: drop.folderId, orderedIds: null };
    }
    const ordered = [...siblingIds(tree, current, dragged.kind, dragged.id), dragged.id];
    return sameList(ordered, currentOrder) ? null : { currentParentId: drop.folderId, targetParentId: drop.folderId, orderedIds: ordered };
  }
  const sib = siblingIds(tree, drop.parentId, dragged.kind, dragged.id);
  const ordered = [...sib.slice(0, drop.index), dragged.id, ...sib.slice(drop.index)];
  if (drop.parentId === current && sameList(ordered, currentOrder)) return null;
  return { currentParentId: current ?? "", targetParentId: drop.parentId ?? "", orderedIds: ordered };
}
