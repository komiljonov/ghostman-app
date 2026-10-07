// {{var}} autocompletion rules (pure; the CodeMirror glue is varCompletion() in
// codemirror.ts, shared by every editor that highlights vars). Unit-tested in
// varComplete.test.ts.
//
// Context: the text before the cursor ends in "{{" + a partial key that is not
// closed (no "{", "}" or newline in it). Anywhere else there is no completion,
// so normal typing never opens the popup.
//
// Options: every variable KEY of the project (all environments, merged by key):
//   1. available   — the key exists in the ACTIVE env: value preview (secrets: lock,
//                    no preview — the hover's masking rule)
//   2. unavailable — only in other envs (or no active env): dimmed, no value,
//                    an env hint ("in prod", "in prod, staging", "in a, b +2")
// Group order is absolute; within a group prefix matches come before substring
// matches, then alphabetical (case-insensitive). The inserted key keeps its case.
import type { EnvDisplay } from "./vars";

export interface CompletionSpot {
  from: number; // where the partial key starts (replaced by the chosen key)
  to: number; // end of the replaced range: the cursor, or the end of the key ahead
  prefix: string; // the partial key typed so far
  closed: boolean; // "}}" already follows: do not insert another one
}

const OPEN_PARTIAL = /\{\{([^{}\n]*)$/;
const KEY_THEN_CLOSE = /^([^{}\n]*)\}\}/;

// before = the line's text up to the cursor, after = from the cursor to the line
// end; `pos` = the cursor's document offset (from/to are document offsets).
export function completionSpot(before: string, after: string, pos: number): CompletionSpot | null {
  const m = OPEN_PARTIAL.exec(before);
  if (!m) return null;
  const prefix = m[1];
  const from = pos - prefix.length;
  // Editing inside an existing {{key}}: replace the rest of the old key too and
  // keep its braces.
  const ahead = KEY_THEN_CLOSE.exec(after);
  if (ahead) return { from, to: pos + ahead[1].length, prefix, closed: true };
  return { from, to: pos, prefix, closed: false };
}

// What accepting `key` does: the text replacing [from, to) and the cursor after it
// (always past the closing braces).
export function applyCompletion(spot: CompletionSpot, key: string): { insert: string; cursor: number } {
  const insert = spot.closed ? key : `${key}}}`;
  return { insert, cursor: spot.from + key.length + 2 };
}

export interface KeyInfo {
  key: string;
  envs: string[]; // environment names defining it, in env order
  secret: boolean;
}

export type OptionGroup = "available" | "unavailable";

export interface VarOption {
  key: string;
  group: OptionGroup;
  secret: boolean; // in the active env (available) / in any env (unavailable)
  detail: string; // value preview, env hint, or "" (secret: lock instead)
}

export const PREVIEW_MAX = 30;

export function preview(value: string): string {
  const flat = value.replace(/\s+/g, " ");
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

// "in prod" / "in prod, staging" / "in prod, staging +2".
export function envHint(envs: string[]): string {
  if (envs.length === 0) return "";
  const shown = envs.slice(0, 2).join(", ");
  return envs.length > 2 ? `in ${shown} +${envs.length - 2}` : `in ${shown}`;
}

// 0 = prefix match, 1 = substring match, -1 = no match (case-insensitive).
function matchRank(key: string, query: string): number {
  if (!query) return 0;
  const k = key.toLowerCase();
  const q = query.toLowerCase();
  if (k.startsWith(q)) return 0;
  return k.includes(q) ? 1 : -1;
}

export interface CompletionData {
  env: EnvDisplay; // the active environment (values for previews)
  keys: KeyInfo[]; // every environment's keys (no values)
}

// The options for a query, in display order. `empty` = the project has no
// variables at all (show the disabled "No variables in this project" line).
export function varOptions(data: CompletionData, query: string): { options: VarOption[]; empty: boolean } {
  const active = data.env.envName !== null ? data.env.vars : new Map();
  const all = new Map<string, VarOption>();
  // Available first: they win the dedupe.
  for (const v of active.values()) {
    all.set(v.key, { key: v.key, group: "available", secret: v.secret, detail: v.secret ? "" : preview(v.value) });
  }
  for (const k of data.keys) {
    if (all.has(k.key)) continue;
    const others = data.env.envName !== null ? k.envs.filter((e) => e !== data.env.envName) : k.envs;
    all.set(k.key, { key: k.key, group: "unavailable", secret: k.secret, detail: envHint(others.length ? others : k.envs) });
  }
  const empty = all.size === 0;
  const ranked = [...all.values()]
    .map((o) => ({ o, rank: matchRank(o.key, query) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) =>
      (a.o.group === b.o.group ? 0 : a.o.group === "available" ? -1 : 1)
      || a.rank - b.rank
      || a.o.key.toLowerCase().localeCompare(b.o.key.toLowerCase())
      || a.o.key.localeCompare(b.o.key));
  return { options: ranked.map((x) => x.o), empty };
}

export const groupLabel = (g: OptionGroup, envName: string | null) =>
  g === "available" ? `In ${envName}` : envName === null ? "No environment selected" : "Other environments";

export const EMPTY_LINE = "No variables in this project";

// ---- Keys (the make-or-break detail) ----
// In single-line editors Enter/Tab belong to the popup while a completion is
// active OR still pending: they accept it (or are swallowed), and only with no
// completion does Enter send / move on and Tab move focus.
export type CompletionStatus = "active" | "pending" | null;

export function enterAction(status: CompletionStatus): "accept" | "swallow" | "default" {
  if (status === "active") return "accept";
  if (status === "pending") return "swallow";
  return "default";
}

export const tabAction = enterAction;
