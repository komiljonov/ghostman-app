import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { childInfo, collapseRanges, foldRangeForLine, placeholderLabel } from "./jsonFold";
import {
  counterText, findMatches, firstAtOrAfter, matchesIn, responseFindTarget, stepIndex,
} from "./responseSearch";
import {
  allHeadersText, bodyMenu, copyAllText, defaultView, headerLine, prettyFallback, ResponseLike, responseMenuKind,
  toolbarControls, viewAvailability,
} from "./responseView";

describe("search in the response body", () => {
  const text = 'token: "a"\n"Token": 1\naccess_token=xyz TOKEN';
  it("is case-insensitive by default, Aa makes it case-sensitive", () => {
    expect(findMatches(text, "token", false).map((m) => text.slice(m.from, m.to)))
      .toEqual(["token", "Token", "token", "TOKEN"]);
    expect(findMatches(text, "Token", true)).toEqual([{ from: 12, to: 17 }]);
  });
  it("is plain text: regex characters match literally", () => {
    expect(findMatches("a.b a+b (x) [y] $z", "a.b", false)).toEqual([{ from: 0, to: 3 }]);
    expect(findMatches("a.b axb", "a.b", false)).toHaveLength(1);
    expect(findMatches("(x) [y] $z", "[y]", false)).toEqual([{ from: 4, to: 7 }]);
    expect(findMatches("anything", "", false)).toEqual([]);
  });
  it("is fast and complete on a 256 KB body", () => {
    const big = '{"token":"abc"},'.repeat(16 * 1024); // 256 KB, 16384 matches
    const t0 = performance.now();
    const m = findMatches(big, "TOKEN", false);
    expect(m).toHaveLength(16384);
    expect(performance.now() - t0).toBeLessThan(200);
    // The viewport only paints its own slice.
    expect(matchesIn(m, 1000, 1100).map((x) => x.from)).toEqual([1010, 1026, 1042, 1058, 1074, 1090]); // 1010 overlaps 1000
  });
  it("jumps with wrap-around; Enter from nothing goes to the first, Shift+Enter to the last", () => {
    expect(stepIndex(-1, 5, 1)).toBe(0);
    expect(stepIndex(-1, 5, -1)).toBe(4);
    expect(stepIndex(4, 5, 1)).toBe(0);
    expect(stepIndex(0, 5, -1)).toBe(4);
    expect(stepIndex(2, 5, 1)).toBe(3);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
  it("finds the first match at/after a position, wrapping", () => {
    const m = [{ from: 5, to: 6 }, { from: 10, to: 11 }, { from: 20, to: 21 }];
    expect(firstAtOrAfter(m, 0)).toBe(0);
    expect(firstAtOrAfter(m, 10)).toBe(1);
    expect(firstAtOrAfter(m, 11)).toBe(2);
    expect(firstAtOrAfter(m, 25)).toBe(0);
    expect(firstAtOrAfter([], 3)).toBe(-1);
  });
  it("counter reads 3/41; no current match yet reads –/41", () => {
    expect(counterText(2, 41)).toBe("3/41");
    expect(counterText(-1, 41)).toBe("–/41");
    expect(counterText(-1, 0)).toBe("0/0");
  });
  it("Ctrl+F focus rule: the response pane wins unless another editor has focus", () => {
    expect(responseFindTarget({ focusInResponse: true, pointerInResponse: false, focusInOtherEditable: false })).toBe(true);
    expect(responseFindTarget({ focusInResponse: false, pointerInResponse: true, focusInOtherEditable: false })).toBe(true);
    // The request body editor / URL / a table cell keeps the key (CodeMirror's own search there).
    expect(responseFindTarget({ focusInResponse: false, pointerInResponse: true, focusInOtherEditable: true })).toBe(false);
    expect(responseFindTarget({ focusInResponse: false, pointerInResponse: false, focusInOtherEditable: false })).toBe(false);
  });
});

describe("collapsible JSON", () => {
  const pretty = JSON.stringify({
    id: 1, tags: ["a", "b", "c"], owner: { name: "x", roles: [{ r: 1 }, { r: 2 }] }, empty: [], one: { k: true },
  }, null, 2);
  const state = EditorState.create({ doc: pretty, extensions: [json()] });
  const lineOf = (needle: string) => {
    const pos = pretty.indexOf(needle);
    const line = state.doc.lineAt(pos);
    return foldRangeForLine(state, line.from, line.to);
  };

  it("folds from after the opening bracket through the closing one", () => {
    const r = lineOf('"tags": [')!;
    expect(pretty.slice(r.from - 1, r.from)).toBe("[");
    expect(pretty.slice(r.to - 1, r.to)).toBe("]");
    expect(lineOf('"id": 1')).toBeNull(); // nothing opens on that line
    expect(lineOf('"empty": []')).toBeNull(); // one-line containers are not foldable
  });
  it("counts children for the badge", () => {
    expect(placeholderLabel(childInfo(state, lineOf('"tags": [')!))).toEqual({ text: "…]", badge: "3 items" });
    expect(placeholderLabel(childInfo(state, lineOf('"owner": {')!))).toEqual({ text: "…}", badge: "2 keys" });
    expect(placeholderLabel(childInfo(state, lineOf('"one": {')!))).toEqual({ text: "…}", badge: "1 key" });
    expect(placeholderLabel(childInfo(state, lineOf("{")!))).toEqual({ text: "…}", badge: "5 keys" });
  });
  it("Collapse All folds exactly the root's multi-line children (depth 1)", () => {
    const ranges = collapseRanges(state, 1);
    const opened = ranges.map((r) => state.doc.lineAt(r.from).text.trim());
    expect(opened).toEqual(['"tags": [', '"owner": {', '"one": {']);
    // depth 2 = inside owner: the roles array
    expect(collapseRanges(state, 2).map((r) => state.doc.lineAt(r.from).text.trim())).toEqual(['"roles": [']);
    expect(collapseRanges(state, 0).map((r) => state.doc.lineAt(r.from).text.trim())).toEqual(["{"]);
  });
  it("handles a top-level array", () => {
    const arr = JSON.stringify([{ a: 1 }, { b: [1, 2] }], null, 2);
    const s = EditorState.create({ doc: arr, extensions: [json()] });
    expect(collapseRanges(s, 1)).toHaveLength(2);
    expect(placeholderLabel(childInfo(s, foldRangeForLine(s, 0, 1)!))).toEqual({ text: "…]", badge: "2 items" });
  });
});

describe("toolbar disable matrix (new buttons included)", () => {
  const html: ResponseLike = { contentType: "text/html", formatted: false, body: "<p>" };
  const at = (section: "body" | "headers", view: "pretty" | "raw" | "preview", structured = true) =>
    toolbarControls({ hasResponse: true, section, view, structured });
  it("search: Pretty/Raw body only", () => {
    expect(at("body", "pretty").search.enabled).toBe(true);
    expect(at("body", "raw").search.enabled).toBe(true);
    expect(at("body", "preview").search).toEqual({ enabled: false, title: "Applies to Pretty and Raw views" });
    expect(at("headers", "raw").search).toEqual({ enabled: false, title: "Applies to body view" });
  });
  it("collapse/expand all: only the Pretty JSON structure view", () => {
    expect(at("body", "pretty").fold.enabled).toBe(true);
    expect(at("body", "pretty", false).fold.enabled).toBe(false); // truncated-JSON fallback
    expect(at("body", "raw").fold.enabled).toBe(false);
    expect(at("body", "preview").fold.enabled).toBe(false);
    expect(at("headers", "pretty").fold.enabled).toBe(false);
  });
  it("save: whenever a response exists, in every view", () => {
    for (const [s, v] of [["body", "pretty"], ["body", "raw"], ["body", "preview"], ["headers", "raw"]] as const) {
      expect(at(s, v).save.enabled).toBe(true);
    }
    const none = toolbarControls({ hasResponse: false, section: "body", view: "raw" });
    expect([none.search.enabled, none.fold.enabled, none.save.enabled]).toEqual([false, false, false]);
    expect(viewAvailability(html).preview.enabled).toBe(true);
  });
  it("truncated JSON: Pretty is offered as flat text (the structure is not)", () => {
    const cut: ResponseLike = { contentType: "application/json", formatted: false, body: '{"a": [1, 2', truncated: true };
    expect(prettyFallback(cut)).toBe(true);
    expect(viewAvailability(cut).pretty).toEqual({ enabled: true, title: "Structure view unavailable (truncated response)" });
    expect(defaultView(cut)).toBe("pretty");
    const invalid: ResponseLike = { contentType: "application/json", formatted: false, body: "{nope" };
    expect(viewAvailability(invalid).pretty.enabled).toBe(false);
  });
});

describe("response context menus", () => {
  it("Copy needs a selection; Copy All and Search always work", () => {
    expect(bodyMenu({ hasSelection: false }).map((i) => [i.action, i.enabled]))
      .toEqual([["copy", false], ["copyAll", true], ["search", true]]);
    expect(bodyMenu({ hasSelection: true })[0].enabled).toBe(true);
  });
  it("which menu: body in Pretty/Raw, headers in Headers, none in Preview or before a response", () => {
    expect(responseMenuKind({ hasResponse: true, section: "body", view: "raw" })).toBe("body");
    expect(responseMenuKind({ hasResponse: true, section: "body", view: "pretty" })).toBe("body");
    expect(responseMenuKind({ hasResponse: true, section: "body", view: "preview" })).toBeNull();
    expect(responseMenuKind({ hasResponse: true, section: "headers", view: "preview" })).toBe("headers");
    expect(responseMenuKind({ hasResponse: false, section: "body", view: "raw" })).toBeNull();
  });
  it("Copy All copies the text as displayed; header lines are Key: value", () => {
    const resp: ResponseLike = { contentType: "application/json", formatted: true, body: '{\n  "a": 1\n}', rawBody: '{"a":1}' };
    expect(copyAllText(resp, "raw")).toBe('{"a":1}');
    expect(copyAllText(resp, "pretty")).toBe('{\n  "a": 1\n}');
    expect(headerLine({ key: "Content-Type", value: "text/html" })).toBe("Content-Type: text/html");
    expect(allHeadersText([{ key: "A", value: "1" }, { key: "B", value: "x: y" }])).toBe("A: 1\nB: x: y");
  });
});
