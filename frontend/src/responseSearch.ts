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
// Collapsed JSON nodes: folding never removes text from the document, so the
// matches (and the "3/41" counter) always cover the FULL text, whatever is
// collapsed. Jumping to a match hidden in collapsed nodes unfolds exactly the
// folds that cover it (its collapsed ancestors; foldsCovering) in the same
// transaction that scrolls to it; other collapsed nodes stay collapsed. Typing
// never expands anything: the current match is the first one not hidden
// (firstUnhidden), or none until Enter. Closing search leaves the expansion as is.
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

// The folded ranges that hide (any part of) a match: what must be unfolded to show it.
export function foldsCovering(folded: Match[], m: Match): Match[] {
  return folded.filter((f) => f.from < m.to && m.from < f.to);
}

// The first match at/after pos that no fold hides (-1 if all are hidden): the
// current match while typing, so typing never expands anything.
export function firstUnhidden(matches: Match[], folded: Match[], pos = 0): number {
  const start = firstAtOrAfter(matches, pos);
  if (start < 0) return -1;
  for (let k = 0; k < matches.length; k++) {
    const i = (start + k) % matches.length;
    if (foldsCovering(folded, matches[i]).length === 0) return i;
  }
  return -1;
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

// "3/41"; "–/41" when there are matches but none is current (all hidden in
// collapsed nodes until Enter jumps to one).
export function counterText(current: number, count: number, capped = false): string {
  if (count === 0) return "0/0";
  return `${current < 0 ? "–" : current + 1}/${count}${capped ? "+" : ""}`;
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

// ---- Search state per tab (survives switching tabs and Pretty/Raw <-> Preview) ----

// What a tab remembers while its search bar is open; undefined = closed.
export interface SavedSearch {
  query: string;
  caseSensitive: boolean;
  current: number; // the selected match (index into all matches), -1 = none
}

// The match to select when the body mounts again with saved search state: the
// saved one if it still exists (same response), else the usual first unhidden one.
export function restoredIndex(saved: number, count: number, fallback: number): number {
  return saved >= 0 && saved < count ? saved : fallback;
}
