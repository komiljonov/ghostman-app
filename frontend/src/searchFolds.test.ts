import { codeFolding, foldEffect } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { collapseRanges, foldRangeForLine, foldsOf, Range, revealEffects } from "./jsonFold";
import { findMatches, firstUnhidden, foldsCovering, Match, stepIndex } from "./responseSearch";

// A nested document like a real API response (pretty-printed as Go does).
const data = {
  meta: { page: 1, owner: { team: { lead: { secretKey: "deep-1" } } } },
  users: [
    { id: 1, profile: { prefs: { secretKey: "deep-2" } } },
    { id: 2, profile: { prefs: { theme: "dark" } } },
  ],
  config: { flags: { beta: { secretKey: "deep-3" } }, other: [1, 2, 3] },
};
const text = JSON.stringify(data, null, 2);
const fresh = () => EditorState.create({ doc: text, extensions: [json(), codeFolding()] });

const fold = (state: EditorState, ranges: Range[]) =>
  state.update({ effects: [...ranges].sort((a, b) => a.from - b.from).map((r) => foldEffect.of(r)) }).state;
const lineOf = (state: EditorState, needle: string, nth = 0) => {
  let pos = -1;
  for (let i = 0; i <= nth; i++) pos = text.indexOf(needle, pos + 1);
  const line = state.doc.lineAt(pos);
  return foldRangeForLine(state, line.from, line.to)!;
};
// Every multi-line object/array, at every depth: "everything collapsed".
const allContainers = (state: EditorState) => [0, 1, 2, 3, 4, 5, 6].flatMap((d) => collapseRanges(state, d));
const reveal = (state: EditorState, m: Match) => state.update({ effects: revealEffects(state, m) }).state;
const hidden = (state: EditorState, m: Match) => foldsCovering(foldsOf(state), m).length > 0;

describe("search over collapsed JSON", () => {
  it("counts every match in the full text whatever is collapsed", () => {
    const open = fresh();
    const collapsedAll = fold(open, collapseRanges(open, 1));
    const everything = fold(open, allContainers(open));
    const count = (s: EditorState) => findMatches(s.doc.toString(), "secretKey", false).length;
    expect(count(open)).toBe(3);
    expect(count(collapsedAll)).toBe(3); // folding keeps the text in the document
    expect(count(everything)).toBe(3);
    expect(foldsOf(everything).length).toBeGreaterThan(8);
  });

  it("a jump 3+ levels under a collapsed root unfolds exactly that ancestor chain", () => {
    const s0 = fold(fresh(), allContainers(fresh()));
    const [deep1] = findMatches(text, "secretKey", false);
    expect(hidden(s0, deep1)).toBe(true);
    const ancestors = [lineOf(s0, "{"), lineOf(s0, '"meta": {'), lineOf(s0, '"owner": {'), lineOf(s0, '"team": {'), lineOf(s0, '"lead": {')];
    expect(foldsCovering(foldsOf(s0), deep1)).toEqual(ancestors.sort((a, b) => a.from - b.from));

    const s1 = reveal(s0, deep1);
    expect(hidden(s1, deep1)).toBe(false);
    // Everything else stays collapsed: users, config and their insides.
    const before = foldsOf(s0);
    const after = foldsOf(s1);
    expect(after).toEqual(before.filter((f) => !ancestors.some((a) => a.from === f.from && a.to === f.to)));
    expect(after).toContainEqual(lineOf(s0, '"users": ['));
    expect(after).toContainEqual(lineOf(s0, '"config": {'));
  });

  it("a jump sequence crossing collapsed branches expands each branch as needed and never re-collapses", () => {
    let s = fold(fresh(), collapseRanges(fresh(), 1)); // Collapse All: meta, users, config
    const matches = findMatches(text, "secretKey", false);
    const meta = lineOf(s, '"meta": {'), users = lineOf(s, '"users": ['), config = lineOf(s, '"config": {');
    expect(foldsOf(s)).toEqual([meta, users, config]);

    s = reveal(s, matches[0]); // in meta
    expect(foldsOf(s)).toEqual([users, config]);
    s = reveal(s, matches[1]); // in users
    expect(foldsOf(s)).toEqual([config]); // meta stays open
    s = reveal(s, matches[2]); // in config
    expect(foldsOf(s)).toEqual([]);
  });

  it("after Collapse All, next and prev both reach every match, each one revealed", () => {
    const matches = findMatches(text, "secretKey", false);
    for (const dir of [1, -1] as const) {
      let s = fold(fresh(), allContainers(fresh()));
      let i = -1;
      const seen = new Set<number>();
      for (let step = 0; step < matches.length; step++) {
        i = stepIndex(i, matches.length, dir);
        s = reveal(s, matches[i]);
        expect(hidden(s, matches[i])).toBe(false);
        seen.add(i);
      }
      expect(seen.size).toBe(matches.length);
    }
  });

  it("typing never expands: the current match is the first one not hidden (or none)", () => {
    const matches = findMatches(text, "secretKey", false);
    const open = fresh();
    expect(firstUnhidden(matches, foldsOf(open))).toBe(0);
    // meta collapsed: the first visible match is the one in users.
    const metaClosed = fold(open, [lineOf(open, '"meta": {')]);
    expect(firstUnhidden(matches, foldsOf(metaClosed))).toBe(1);
    // all collapsed: none is current until Enter jumps (which expands).
    const closed = fold(open, collapseRanges(open, 1));
    expect(firstUnhidden(matches, foldsOf(closed))).toBe(-1);
    expect(stepIndex(-1, matches.length, 1)).toBe(0);
  });

  it("a match straddling a fold edge counts as hidden and unfolds that fold", () => {
    expect(foldsCovering([{ from: 10, to: 20 }], { from: 8, to: 12 })).toEqual([{ from: 10, to: 20 }]);
    expect(foldsCovering([{ from: 10, to: 20 }], { from: 20, to: 25 })).toEqual([]);
    expect(foldsCovering([{ from: 10, to: 20 }], { from: 4, to: 10 })).toEqual([]);
  });
});
