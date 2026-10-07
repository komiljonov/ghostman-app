// Bulk edit: a text view over a key/value row array (params, headers, form
// fields). Storage is unchanged — the rows stay the source of truth; this is only
// how they are shown and typed. Postman-compatible format, one entry per line:
//
//   key:value          value = everything after the FIRST colon, verbatim —
//                      colons, commas, braces, whole JSON blobs survive
//                      (order:{"a":1,"b":{"c":2}} → key "order", value the JSON)
//   //key:value        a disabled row (re-enable by removing the slashes)
//   key                no colon → the key with an empty value
//   (blank line)       ignored
//
// Whitespace around the KEY is trimmed; the value is kept exactly — a space after
// the colon becomes part of the value (Postman does the same).
// Lossy only for keys that themselves contain ":" or start with "//" (the grammar
// cannot express them); everything else round-trips exactly.
import type { Row } from "./rows";

const DISABLED = "//";

export function serializeRows(rows: Row[]): string {
  return rows
    .filter((r) => r.key !== "" || r.value !== "" || !r.enabled) // the empty editing row is not content
    .map((r) => `${r.enabled ? "" : DISABLED}${r.key}:${r.value}`)
    .join("\n");
}

export function parseLine(line: string): Row | null {
  const text = line.replace(/\r$/, "");
  if (text.trim() === "") return null;
  let rest = text.replace(/^\s+/, "");
  let enabled = true;
  if (rest.startsWith(DISABLED)) {
    enabled = false;
    rest = rest.slice(DISABLED.length);
  }
  const colon = rest.indexOf(":");
  const key = (colon < 0 ? rest : rest.slice(0, colon)).trim();
  const value = colon < 0 ? "" : rest.slice(colon + 1);
  if (key === "" && value === "") return null; // "//" or ":" alone carries nothing
  return { key, value, enabled };
}

export function parseBulk(text: string): Row[] {
  const out: Row[] = [];
  for (const line of text.split("\n")) {
    const row = parseLine(line);
    if (row) out.push(row);
  }
  return out;
}

const sameRows = (a: Row[], b: Row[]) =>
  a.length === b.length && a.every((r, i) => r.key === b[i].key && r.value === b[i].value && r.enabled === b[i].enabled);

// Whether the editor's text already means these rows: then an outside change
// (e.g. the URL bar rewriting params) must NOT rewrite it — typing is never
// clobbered, blank lines and spacing survive.
export const textMeansRows = (text: string, rows: Row[]) =>
  sameRows(parseBulk(text), rows.filter((r) => r.key !== "" || r.value !== "" || !r.enabled));

// The three tables with a bulk view, and their (global) preference keys.
export type BulkKind = "params" | "headers" | "form";
export const BULK_KINDS: BulkKind[] = ["params", "headers", "form"];
