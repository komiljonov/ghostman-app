// Keyboard model of the sidebar tree: the selected node, arrow-key navigation and
// the tree shortcuts (Ctrl+E rename, Del delete, Ctrl+D duplicate). Pure functions
// over the rendered rows, so they are unit-testable; ProjectTree wires them up.
import type { TreeNode } from "./tree";

// One rendered row, in screen order.
export interface VisibleRow {
  id: string;
  kind: "folder" | "request";
  parentId: string | null; // containing folder, null at the project root
  expanded: boolean; // folders only
}

// Rows in screen order: children of expanded folders follow their folder.
export function visibleRows(root: TreeNode[], isExpanded: (id: string) => boolean): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (nodes: TreeNode[], parentId: string | null) => {
    for (const n of nodes) {
      const expanded = n.kind === "folder" && isExpanded(n.id);
      out.push({ id: n.id, kind: n.kind, parentId, expanded });
      if (n.kind === "folder" && expanded) walk(n.children, n.id);
    }
  };
  walk(root, null);
  return out;
}

export type TreeMove =
  | { type: "select" | "expand" | "collapse" | "toggle" | "open"; id: string }
  | null;

// What an arrow/Enter/Home/End key does with the current selection.
//   Up/Down     previous/next visible row (nothing selected: first/last row)
//   Right       collapsed folder: expand; expanded folder: go to its first child
//   Left        expanded folder: collapse; otherwise go to the containing folder
//   Enter       request: open; folder: expand/collapse
export function navigate(rows: VisibleRow[], selectedId: string | undefined, key: string): TreeMove {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.id === selectedId);
  const at = (j: number): TreeMove => ({ type: "select", id: rows[j].id });
  if (i < 0) {
    if (key === "ArrowDown" || key === "Home") return at(0);
    if (key === "ArrowUp" || key === "End") return at(rows.length - 1);
    return null;
  }
  const row = rows[i];
  switch (key) {
    case "ArrowDown":
      return i + 1 < rows.length ? at(i + 1) : null;
    case "ArrowUp":
      return i > 0 ? at(i - 1) : null;
    case "Home":
      return at(0);
    case "End":
      return at(rows.length - 1);
    case "ArrowRight":
      if (row.kind !== "folder") return null;
      if (!row.expanded) return { type: "expand", id: row.id };
      return rows[i + 1]?.parentId === row.id ? at(i + 1) : null;
    case "ArrowLeft":
      if (row.kind === "folder" && row.expanded) return { type: "collapse", id: row.id };
      return row.parentId ? { type: "select", id: row.parentId } : null;
    case "Enter":
      return row.kind === "request" ? { type: "open", id: row.id } : { type: "toggle", id: row.id };
    default:
      return null;
  }
}

export type TreeShortcut = "rename" | "delete" | "duplicate";

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function treeShortcut(e: KeyLike): TreeShortcut | null {
  if (e.altKey || e.shiftKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "e") return "rename";
  if (mod && k === "d") return "duplicate";
  if (!mod && e.key === "Delete") return "delete";
  return null;
}

// Duplicate is for requests only (on a folder it does nothing).
export function shortcutApplies(action: TreeShortcut, kind: "folder" | "request"): boolean {
  return action !== "duplicate" || kind === "request";
}

interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

// Typing targets: inputs (e.g. the inline rename), textareas, selects, any
// contenteditable and anything inside a CodeMirror editor.
export function isEditableTarget(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  const tag = (t.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return !!t.closest?.(".cm-editor");
}

// Tree shortcuts and navigation run only while the tree itself has focus: not
// with a modal open, not during an inline rename, not from an input or editor.
export function canUseTreeKeys(s: { modalOpen: boolean; renaming: boolean; target: TargetLike | null }): boolean {
  return !s.modalOpen && !s.renaming && !isEditableTarget(s.target);
}
