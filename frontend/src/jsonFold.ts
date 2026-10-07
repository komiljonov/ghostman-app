// Collapsible JSON for the Pretty view: which ranges Collapse All folds, and the
// "{…} 12 keys" / "[…] 48 items" placeholder. Works on a CodeMirror EditorState
// with the JSON language (no view, so unit-testable in node). The folded range of
// an object/array runs from after its "{" / "[" THROUGH its closing bracket, so a
// collapsed node reads `{…} 12 keys` (the placeholder supplies "…}" and the badge);
// foldRangeForLine is registered as the fold service so the gutter, Collapse All
// and the badge all agree on that range.
import { ensureSyntaxTree, foldedRanges, syntaxTree, unfoldEffect } from "@codemirror/language";
import type { EditorState, StateEffect } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface Range {
  from: number;
  to: number;
}

const isContainer = (n: SyntaxNode) => n.name === "Object" || n.name === "Array";
const VALUE = new Set(["Object", "Array", "String", "Number", "True", "False", "Null"]);

// Parse the whole document (bounded): folding operates on the full tree.
function tree(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 2000) ?? syntaxTree(state);
}

// Nesting depth of a container: the top-level value is 0.
function depthOf(node: SyntaxNode): number {
  let d = 0;
  for (let p = node.parent; p; p = p.parent) if (isContainer(p)) d++;
  return d;
}

const foldRange = (n: SyntaxNode): Range => ({ from: n.from + 1, to: n.to });

// Fold service: the container that opens on this line (innermost one that starts
// on it and ends after it), e.g. `  "items": [`.
export function foldRangeForLine(state: EditorState, lineStart: number, lineEnd: number): Range | null {
  for (let n: SyntaxNode | null = tree(state).resolveInner(lineEnd, -1); n; n = n.parent) {
    if (n.from < lineStart) return null;
    if (isContainer(n) && n.to > lineEnd) return foldRange(n);
  }
  return null;
}

// Containers at exactly `depth` that span more than one line (one-liners like [] or
// {"a":1} stay as they are). Collapse All = depth 1: the root stays open and each
// of its children is shown collapsed.
export function collapseRanges(state: EditorState, depth = 1): Range[] {
  const out: Range[] = [];
  tree(state).iterate({
    enter: (ref) => {
      const n = ref.node;
      if (!isContainer(n)) return undefined;
      const d = depthOf(n);
      if (d === depth && state.doc.lineAt(n.from).number !== state.doc.lineAt(n.to).number) out.push(foldRange(n));
      return d >= depth ? false : undefined; // deeper ones are inside a folded range anyway
    },
  });
  return out;
}

export interface ChildInfo {
  kind: "object" | "array";
  count: number;
}

// What a folded range holds: its container kind and number of children.
export function childInfo(state: EditorState, range: Range): ChildInfo | null {
  let node: SyntaxNode | null = tree(state).resolveInner(range.from, -1);
  for (; node; node = node.parent) {
    if (isContainer(node) && node.from + 1 === range.from) break;
  }
  if (!node) return null;
  let count = 0;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (node.name === "Object" ? c.name === "Property" : VALUE.has(c.name)) count++;
  }
  return { kind: node.name === "Object" ? "object" : "array", count };
}

// The placeholder replaces the folded range (which ends with the closing bracket).
export function placeholderLabel(info: ChildInfo | null): { text: string; badge: string } {
  if (!info) return { text: "…", badge: "" };
  const unit = info.kind === "object" ? (info.count === 1 ? "key" : "keys") : info.count === 1 ? "item" : "items";
  return { text: info.kind === "object" ? "…}" : "…]", badge: `${info.count} ${unit}` };
}

// The folds currently in a state, as plain ranges.
export function foldsOf(state: EditorState): Range[] {
  const out: Range[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => void out.push({ from, to }));
  return out;
}

// Unfold effects that reveal [from, to): every fold overlapping it — exactly its
// collapsed ancestors; nothing else is touched.
export function revealEffects(state: EditorState, m: Range): StateEffect<Range>[] {
  return foldsOf(state).filter((f) => f.from < m.to && m.from < f.to).map((f) => unfoldEffect.of(f));
}
