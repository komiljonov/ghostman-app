// Autocompletion for the sandbox's globals in the script editors: `gm.…` and
// `console.…`. The VM injects them at run time (Go: internal/scripting), so the
// JavaScript language support knows nothing about them; this builds the member
// tree from the gm API docs (the ONE source, scripting.APIDocs — the same list
// the ? popover shows) and answers "what comes after this path". Pure; the
// CodeMirror glue (path at the cursor, async docs) is scriptCompletion() in
// codemirror.ts.
import type { scripting } from "../wailsjs/go/models";

export type MemberKind = "namespace" | "function" | "property";

export interface Member {
  name: string;
  kind: MemberKind;
  doc?: scripting.Doc; // leaves only
  children: Map<string, Member>;
}

const node = (name: string, kind: MemberKind): Member => ({ name, kind, children: new Map() });

// buildMembers turns the docs into a tree rooted at the globals: gm, and console
// (an alias of gm.console, as the VM sets it).
export function buildMembers(docs: scripting.Doc[]): Member {
  const root = node("", "namespace");
  for (const d of docs) {
    const parts = d.name.split(".");
    let at = root;
    parts.forEach((part, i) => {
      const leaf = i === parts.length - 1;
      let next = at.children.get(part);
      if (!next) {
        next = node(part, leaf ? (d.usage.includes("(") ? "function" : "property") : "namespace");
        at.children.set(part, next);
      }
      if (leaf) next.doc = d;
      at = next;
    });
  }
  const gmConsole = root.children.get("gm")?.children.get("console");
  if (gmConsole) root.children.set("console", { ...gmConsole, name: "console" });
  return root;
}

export interface MemberOption {
  label: string;
  type: "namespace" | "function" | "property" | "variable";
  detail: string; // the signature
  info: string; // summary · example · where it applies
}

// memberOptions lists what may follow `path` (["gm", "request"] after
// "gm.request."); the globals themselves for an empty path. null: not a gm /
// console path (leave it to the language's own completion).
export function memberOptions(root: Member, path: readonly string[]): MemberOption[] | null {
  let at: Member | undefined = root;
  for (const p of path) {
    at = at?.children.get(p);
    if (!at) return null;
  }
  if (!at || at.kind !== "namespace") return null;
  const out: MemberOption[] = [];
  for (const m of at.children.values()) {
    const where = m.doc?.where === "pre" ? "pre-request scripts only" : m.doc?.where === "post" ? "post-response scripts only" : "";
    out.push({
      label: m.name,
      type: path.length === 0 ? "variable" : m.kind === "namespace" ? "namespace" : m.kind,
      detail: m.doc ? signature(m.doc, path.length === 0) : m.kind === "namespace" ? "object" : "",
      info: m.doc ? [m.doc.summary, m.doc.example && `e.g. ${m.doc.example}`, where].filter(Boolean).join("\n") : groupInfo(m),
    });
  }
  return out;
}

// "(key, value)" for functions, "" for properties: the label already says the name.
function signature(d: scripting.Doc, top: boolean): string {
  if (top) return "";
  const open = d.usage.indexOf("(");
  return open >= 0 ? d.usage.slice(open) : "";
}

function groupInfo(m: Member): string {
  const names = [...m.children.keys()];
  return names.length ? `${names.join(", ")}` : "";
}
