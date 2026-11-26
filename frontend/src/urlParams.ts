// Two-way sync between the URL input and the Params tab. THIS MODULE IS THE SPEC
// (pinned by urlParams.test.ts).
//
// One source of truth: the request's query_params rows (what autosave persists),
// plus the base url (everything before "?"), stored as `url`. The URL input
// DISPLAYS base + the enabled params serialized; the Params tab edits the rows.
//
// Parsing (URL input → pairs): text after the first "?" splits on "&", each part
// on its first "=" → ordered {key, value} pairs. No percent-decoding/encoding
// here — keys and values stay verbatim as typed (they may hold {{vars}}); the Go
// engine encodes at send time. Empty parts (trailing "&", "&&") are ignored, as
// are pairs without a key ("=v"): a keyless row is never part of the URL.
//
// URL edit → rows (reconcile): the URL represents exactly the "URL rows" — enabled
// rows with a key. They are matched to the parsed pairs IN ORDER and updated in
// place; extra pairs append as new enabled rows at the end; URL rows without a
// pair are deleted. Disabled rows and keyless rows are untouched and keep their
// positions. Nothing changed → the same array is returned (no needless save).
//
// Rows → URL (serialize): base + "?" + URL rows joined "k=v" with "&" (an empty
// value is always "k="); no "?" at all when there are none.
//
// Loops: rows → URL is only applied to the URL input when its text does not
// already mean the same thing (sameMeaning), and that programmatic write does not
// report a change back. URL → rows never rewrites the URL input while typing.
import { newRow, Row } from "./rows";

export interface Pair {
  key: string;
  value: string;
}

export interface SplitUrl {
  base: string;
  pairs: Pair[];
}

const hasKey = (key: string) => key.trim() !== "";

// The rows the URL string represents.
export const isUrlRow = (r: Row) => r.enabled && hasKey(r.key);

export function splitUrl(text: string): SplitUrl {
  const q = text.indexOf("?");
  if (q < 0) return { base: text, pairs: [] };
  const pairs: Pair[] = [];
  for (const part of text.slice(q + 1).split("&")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    const pair = eq < 0 ? { key: part, value: "" } : { key: part.slice(0, eq), value: part.slice(eq + 1) };
    if (hasKey(pair.key)) pairs.push(pair);
  }
  return { base: text.slice(0, q), pairs };
}

export function serializeUrl(base: string, rows: Row[]): string {
  const query = rows.filter(isUrlRow).map((r) => `${r.key}=${r.value}`).join("&");
  return query ? `${base}?${query}` : base;
}

export function reconcileParams(rows: Row[], pairs: Pair[]): Row[] {
  const urlIdx: number[] = [];
  rows.forEach((r, i) => isUrlRow(r) && urlIdx.push(i));
  const matched = Math.min(urlIdx.length, pairs.length);
  let changed = urlIdx.length !== pairs.length;
  const next = rows.slice();
  for (let i = 0; i < matched; i++) {
    const at = urlIdx[i];
    const { key, value } = pairs[i];
    if (next[at].key !== key || next[at].value !== value) {
      next[at] = { ...next[at], key, value }; // in place: same row, new text
      changed = true;
    }
  }
  if (!changed) return rows;
  const drop = new Set(urlIdx.slice(matched)); // URL rows the text no longer has
  const kept = drop.size ? next.filter((_, i) => !drop.has(i)) : next;
  return [...kept, ...pairs.slice(matched).map((p) => newRow({ key: p.key, value: p.value }))];
}

// A URL-input edit, applied to the stored parts. Returns the same `rows` array
// when the params did not change (e.g. only the base url was edited).
export function applyUrlInput(text: string, rows: Row[]): { url: string; rows: Row[] } {
  const { base, pairs } = splitUrl(text);
  return { url: base, rows: reconcileParams(rows, pairs) };
}

// Whether two URL-input texts describe the same base + pairs (so the input does
// not need rewriting, e.g. "x?a=1&" while typing vs the canonical "x?a=1").
export function sameMeaning(a: string, b: string): boolean {
  const x = splitUrl(a);
  const y = splitUrl(b);
  return x.base === y.base && x.pairs.length === y.pairs.length &&
    x.pairs.every((p, i) => p.key === y.pairs[i].key && p.value === y.pairs[i].value);
}

// Requests saved before this model may still have a query inside `url`. On load
// it moves into the rows: its pairs come first (that is where they were sent),
// then the existing rows. Persisted with the next save, not on open.
export function adoptUrlQuery(url: string, rows: Row[]): { url: string; rows: Row[] } {
  if (!url.includes("?")) return { url, rows };
  const { base, pairs } = splitUrl(url);
  return { url: base, rows: [...pairs.map((p) => newRow({ key: p.key, value: p.value })), ...rows] };
}

// ── Path variables (Postman-style ":id") ─────────────────────────────────────
// Derivation (Go twin: internal/engine/pathvars.go — keep both test tables in
// step): the URL text before the first "?" splits on "/"; a segment that is
// exactly ":" + [A-Za-z_][A-Za-z0-9_]* is a path variable. Keys in order of
// first appearance, once each.
//
// Rows (`path_params`, {key, value}, saved with the autosave PATCH) follow the
// URL: values persist BY KEY; a row whose key left the URL is dropped; a new key
// appends with an empty value. The keys are read-only in the Params tab, so the
// rows never write back into the URL — no loop to guard; nothing changed → the
// same array (no needless save).
export interface PathParam {
  key: string;
  value: string;
}

const PATH_KEY = /^:[A-Za-z_][A-Za-z0-9_]*$/;

export function pathVarKeys(url: string): string[] {
  const q = url.indexOf("?");
  const path = q < 0 ? url : url.slice(0, q);
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (PATH_KEY.test(seg) && !out.includes(seg.slice(1))) out.push(seg.slice(1));
  }
  return out;
}

// The segments of a URL text that are path variables: [from, to) offsets of
// ":key" (for highlighting), with the key.
export function pathVarSpans(url: string): { key: string; from: number; to: number }[] {
  const q = url.indexOf("?");
  const end = q < 0 ? url.length : q;
  const out: { key: string; from: number; to: number }[] = [];
  let start = 0;
  while (start <= end) {
    let slash = url.indexOf("/", start);
    if (slash < 0 || slash > end) slash = end;
    const seg = url.slice(start, slash);
    if (PATH_KEY.test(seg)) out.push({ key: seg.slice(1), from: start, to: slash });
    start = slash + 1;
  }
  return out;
}

export function reconcilePathParams(rows: PathParam[], url: string): PathParam[] {
  const keys = pathVarKeys(url);
  const kept = rows.filter((r, i) => keys.includes(r.key) && rows.findIndex((x) => x.key === r.key) === i);
  const added = keys.filter((k) => !kept.some((r) => r.key === k)).map((key) => ({ key, value: "" }));
  if (added.length === 0 && kept.length === rows.length) return rows;
  return [...kept, ...added];
}
