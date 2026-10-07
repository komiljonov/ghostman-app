// Search in the response body (Pretty / Raw), plain text only. Pure functions;
// ResponseBody wires them to the viewer.
//
// Approach for big bodies (up to the 256 KB preview): all match offsets are found
// in one pass (a regex over the escaped query — exact offsets even for
// case-insensitive matching, where toLowerCase could change lengths), which is a
// few milliseconds. Highlighting is the expensive part, so the viewer decorates
// only the matches inside its visible ranges (matchesIn: binary search over the
// sorted offsets); scrolling re-decorates just the new viewport.
//
// Focus rule for Ctrl+F (responseFindTarget): the request body editor keeps
// CodeMirror's own search (it handles Ctrl+F itself first); any other editable
// field outside the response pane keeps the key; anywhere else, Ctrl+F opens the
// response search when focus is in the response pane or the pointer is over it.

export interface Match {
  from: number;
  to: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const MAX_MATCHES = 100_000;

export function findMatches(text: string, query: string, caseSensitive: boolean, limit = MAX_MATCHES): Match[] {
  if (query === "") return [];
  const re = new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
  const out: Match[] = [];
  for (let m = re.exec(text); m && out.length < limit; m = re.exec(text)) {
    out.push({ from: m.index, to: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++; // cannot happen for a non-empty query; never loop
  }
  return out;
}

// Matches hidden inside collapsed JSON nodes are not navigable (out of scope:
// search does not auto-expand). Ranges are the folded (inner) ranges.
export function visibleMatches(matches: Match[], folded: Match[]): Match[] {
  if (folded.length === 0) return matches;
  return matches.filter((m) => !folded.some((f) => m.from >= f.from && m.to <= f.to));
}

// Next/previous with wrap-around; from "no current match" (-1) Enter goes to the
// first, Shift+Enter to the last.
export function stepIndex(current: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

// Index of the first match starting at or after pos (wrapping to 0).
export function firstAtOrAfter(matches: Match[], pos: number): number {
  if (matches.length === 0) return -1;
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].from < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}

// The matches overlapping [from, to) — what the viewport needs to paint.
export function matchesIn(matches: Match[], from: number, to: number): Match[] {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].to <= from) lo = mid + 1;
    else hi = mid;
  }
  const out: Match[] = [];
  for (let i = lo; i < matches.length && matches[i].from < to; i++) out.push(matches[i]);
  return out;
}

export function counterText(current: number, count: number, capped = false): string {
  if (count === 0) return "0/0";
  return `${current < 0 ? 0 : current + 1}/${count}${capped ? "+" : ""}`;
}

export interface FindContext {
  focusInResponse: boolean; // focus is somewhere in the response pane
  pointerInResponse: boolean;
  focusInOtherEditable: boolean; // an input/textarea/CodeMirror outside the response pane has focus
}

export function responseFindTarget(c: FindContext): boolean {
  if (c.focusInResponse) return true;
  if (c.focusInOtherEditable) return false;
  return c.pointerInResponse;
}
