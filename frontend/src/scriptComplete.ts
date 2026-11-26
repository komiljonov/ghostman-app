// Autocompletion and hover docs for the sandbox's globals in the script editors:
// `gm.…` and `console.…`. The VM injects them at run time (Go: internal/scripting),
// so the JavaScript language support knows nothing about them; this builds the
// member tree from the gm API docs (the ONE source, scripting.APIDocs — the same
// list the ? popover shows) and answers "what comes after this path", "what is
// under the pointer", and "which env key goes in gm.environment.get(\"…". Pure;
// the CodeMirror glue (path at the cursor, async docs) is scriptCompletion() /
// scriptHover() in codemirror.ts.
//
// Pre / post context (the editor knows which it is): out-of-phase members — the
// gm.response family in a pre-request script, the gm.request mutators in a
// post-response one — are still OFFERED (discoverable), but marked "(post only)"
// / "(pre only)", dimmed and ranked last. CodeMirror cannot disable an option:
// accepted anyway, the VM throws its own clear error at run time.
import type { scripting } from "../wailsjs/go/models";

export type MemberKind = "namespace" | "function" | "property";
export type Phase = "pre" | "post";

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

// Where a member applies: its doc's; a namespace applies where ALL its members do
// (gm.response → post; gm.request → both, though some of its members are pre-only).
export function whereOf(m: Member): "" | Phase {
  if (m.doc) return (m.doc.where as "" | Phase) || "";
  const all = [...m.children.values()].map(whereOf);
  return all.length > 0 && all.every((w) => w === all[0]) ? all[0] : "";
}

const phaseNote = (where: "" | Phase) => (where === "pre" ? "pre only" : where === "post" ? "post only" : "");
const whereText = (where: "" | Phase) =>
  where === "pre" ? "pre-request scripts only" : where === "post" ? "post-response scripts only" : "";

export interface MemberOption {
  label: string;
  type: "namespace" | "function" | "property" | "variable";
  detail: string; // the signature (+ " · post only" when out of phase)
  info: string; // summary · returns · example · where it applies
  outOfPhase: boolean; // dimmed and ranked last (see the package comment)
  call: boolean; // a function: accepting inserts name() with the cursor inside
}

// memberOptions lists what may follow `path` (["gm", "request"] after
// "gm.request."); the globals themselves for an empty path. null: not a gm /
// console path (leave it to the language's own completion). With a phase,
// out-of-phase members are marked and sorted after the rest (stable otherwise).
export function memberOptions(root: Member, path: readonly string[], phase?: Phase): MemberOption[] | null {
  let at: Member | undefined = root;
  for (const p of path) {
    at = at?.children.get(p);
    if (!at) return null;
  }
  if (!at || at.kind !== "namespace") return null;
  const out: MemberOption[] = [];
  for (const m of at.children.values()) {
    const where = whereOf(m);
    const outOfPhase = !!phase && where !== "" && where !== phase;
    const sig = m.doc ? signature(m.doc, path.length === 0) : m.kind === "namespace" ? "object" : "";
    const ret = m.doc?.returns ? (sig ? ` → ${m.doc.returns}` : m.doc.returns) : "";
    out.push({
      label: m.name,
      type: path.length === 0 ? "variable" : m.kind === "namespace" ? "namespace" : m.kind,
      detail: [sig + ret, outOfPhase ? phaseNote(where) : ""].filter(Boolean).join(" · "),
      info: m.doc
        ? [m.doc.summary, m.doc.returns && `Returns: ${m.doc.returns}`, m.doc.example && `e.g. ${m.doc.example}`, whereText(where)]
          .filter(Boolean).join("\n")
        : [groupInfo(m), whereText(where)].filter(Boolean).join("\n"),
      outOfPhase,
      call: m.kind === "function",
    });
  }
  return [...out.filter((o) => !o.outOfPhase), ...out.filter((o) => o.outOfPhase)];
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

// What accepting an option inserts: a function as name() with the cursor between
// the parens — just the name when a "(" already follows (re-picking an existing call).
export function insertion(label: string, call: boolean, nextChar: string): { text: string; cursor: number } {
  if (!call || nextChar === "(") return { text: label, cursor: label.length };
  return { text: `${label}()`, cursor: label.length + 1 };
}

// ---- Env keys inside gm.environment.get(" / .set(" / .unset(" ----

// The key being typed as the FIRST argument of gm.environment.get / set / unset,
// in an open string literal ending at the cursor; null anywhere else. The options
// are the {{var}} completion's (varComplete.varOptions: keys of the active
// environment first, other environments' dimmed).
export function envKeySpot(before: string): { prefix: string; start: number } | null {
  const m = /gm\s*\.\s*environment\s*\.\s*(?:get|set|unset)\s*\(\s*(["'`])([^"'`\\\n]*)$/.exec(before);
  if (!m) return null;
  return { prefix: m[2], start: before.length - m[2].length };
}

// ---- Hover ----

// The member expression under the pointer (column `col` of `line`): the dotted
// path from its start through the hovered segment ("gm.environment" when hovering
// "environment" in gm.environment.set). null outside an identifier.
export function memberAt(line: string, col: number): { path: string[]; from: number; to: number } | null {
  const ident = /[\w$]/;
  if (col >= line.length || !ident.test(line[col])) {
    if (col > 0 && ident.test(line[col - 1])) col -= 1; // the pointer just past a word
    else return null;
  }
  let to = col;
  while (to < line.length && ident.test(line[to])) to++;
  let from = col;
  // Walk back over identifiers and dots (whitespace around dots is not JS style here).
  while (from > 0 && /[\w$.]/.test(line[from - 1])) from--;
  const text = line.slice(from, to);
  if (text.startsWith(".") || text.includes("..")) return null;
  return { path: text.split("."), from, to };
}

export interface HoverDoc {
  title: string; // the call form ("gm.environment.set(key, value)") or the namespace path
  returns: string;
  summary: string;
  example: string;
  where: string; // "post-response scripts only" …
  outOfPhase: boolean;
}

// The doc for a hovered path (console.* is the gm.console alias); null when it
// is not a gm / console member.
export function hoverDoc(root: Member, path: readonly string[], phase?: Phase): HoverDoc | null {
  let at: Member | undefined = root;
  for (const p of path) {
    at = at?.children.get(p);
    if (!at) return null;
  }
  if (!at || at === root) return null;
  const where = whereOf(at);
  const outOfPhase = !!phase && where !== "" && where !== phase;
  if (at.doc) {
    return { title: at.doc.usage, returns: at.doc.returns, summary: at.doc.summary, example: at.doc.example, where: whereText(where), outOfPhase };
  }
  return { title: path.join("."), returns: "", summary: `Members: ${groupInfo(at)}`, example: "", where: whereText(where), outOfPhase };
}
