// Format JSON in the raw body editor (Ctrl/Cmd+Shift+F or the Format button).
// The formatting itself — masking {{vars}}, indenting, error positions — is Go
// (internal/jsonfmt, bound FormatJSONBody). This file holds only the editor
// side: when Format applies, and how its result becomes ONE CodeMirror change.

export const FORMAT_SHORTCUT = "Ctrl+Shift+F";

export interface FormatGate {
  enabled: boolean;
  reason: string; // the button's tooltip
}

// Format applies to a raw body with a JSON content type (the JSON preset or any
// type containing "json") that is not blank. Disabled (never hidden) otherwise.
export function formatGate(body: { type: string; content_type: string; content: string }): FormatGate {
  if (body.type !== "raw") return { enabled: false, reason: "Format applies to a raw JSON body" };
  if (!body.content_type.toLowerCase().includes("json")) return { enabled: false, reason: "Format needs a JSON content type" };
  if (body.content.trim() === "") return { enabled: false, reason: "Nothing to format" };
  return { enabled: true, reason: `Format JSON (${FORMAT_SHORTCUT})` };
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

const isWS = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

// Formatting only changes whitespace (Go keeps every other character, {{tokens}}
// included, in order), so the change is computed as whitespace edits between the
// same non-whitespace characters. CodeMirror then maps the cursor and selection
// through it naturally (a cursor stays next to the character it was next to) and
// unchanged runs, such as spaces inside strings, are not touched at all.
// Returns null when the texts differ in anything but whitespace (caller: replace all).
export function whitespaceChanges(before: string, after: string): TextChange[] | null {
  const changes: TextChange[] = [];
  let i = 0;
  let j = 0;
  for (;;) {
    const i0 = i;
    const j0 = j;
    while (i < before.length && isWS(before[i])) i++;
    while (j < after.length && isWS(after[j])) j++;
    if (before.slice(i0, i) !== after.slice(j0, j)) changes.push({ from: i0, to: i, insert: after.slice(j0, j) });
    if (i === before.length || j === after.length) {
      return i === before.length && j === after.length ? changes : null;
    }
    if (before[i] !== after[j]) return null;
    i++;
    j++;
  }
}
