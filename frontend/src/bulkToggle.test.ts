import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { bulkEditorExtension, toggleBulkLines } from "./codemirror";
import { parseBulk, serializeRows } from "./bulkEdit";

// "|" marks the cursor; "[" ... "]" a selection (anchor at "[", head at "]").
function make(doc: string, bulk = true): EditorState {
  let text = doc;
  let anchor: number;
  let head: number;
  if (text.includes("[")) {
    anchor = text.indexOf("[");
    text = text.replace("[", "");
    head = text.indexOf("]");
    text = text.replace("]", "");
  } else {
    anchor = head = text.indexOf("|");
    text = text.replace("|", "");
  }
  return EditorState.create({
    doc: text,
    selection: EditorSelection.single(anchor, head),
    extensions: bulk ? bulkEditorExtension : [],
  });
}

function press(state: EditorState): { state: EditorState; changed: boolean; handled: boolean } {
  let tr: Transaction | undefined;
  const handled = toggleBulkLines({ state, dispatch: (t) => (tr = t) });
  return { state: tr ? tr.state : state, changed: !!tr, handled };
}

const show = (s: EditorState) => {
  const { anchor, head } = s.selection.main;
  const d = s.doc.toString();
  if (anchor === head) return d.slice(0, head) + "|" + d.slice(head);
  return d.slice(0, anchor) + "[" + d.slice(anchor, head) + "]" + d.slice(head);
};

const lines = (...l: string[]) => l.join("\n");

describe("Ctrl+/ in bulk editors", () => {
  it("no selection: toggles the cursor's line (column 0 / before the key), cursor mapped", () => {
    const once = press(make(lines("a:1", "b:|2", "c:3")));
    expect(show(once.state)).toBe(lines("a:1", "//b:|2", "c:3"));
    expect(show(press(once.state).state)).toBe(lines("a:1", "b:|2", "c:3"));
  });

  it("selection: every touched line; the selection is mapped with the prefix", () => {
    expect(show(press(make(lines("[a:1", "b:2", "c]:3"))).state)).toBe(lines("//[a:1", "//b:2", "//c]:3"));
  });

  it("a selection ending at the start of a line does not touch that line", () => {
    expect(press(make(lines("[a:1", "b:2", "]c:3"))).state.doc.toString()).toBe(lines("//a:1", "//b:2", "c:3"));
  });

  it("mixed selection: disables the enabled ones (uniform), never double-prefixes; next press enables all", () => {
    const first = press(make(lines("[a:1", "//b:2", "  c:3]"))).state;
    expect(first.doc.toString()).toBe(lines("//a:1", "//b:2", "  //c:3"));
    expect(parseBulk(first.doc.toString()).map((r) => [r.key, r.enabled])).toEqual([["a", false], ["b", false], ["c", false]]);
    expect(press(first).state.doc.toString()).toBe(lines("a:1", "b:2", "  c:3"));
  });

  it("uncomment removes // and ONE following space, indentation kept", () => {
    expect(press(make(lines("[//a:1", "// b:2", "//  c:3", "  //d:4]"))).state.doc.toString())
      .toBe(lines("a:1", "b:2", " c:3", "  d:4"));
  });

  it("blank lines are skipped; a lone blank line changes nothing", () => {
    expect(press(make(lines("[a:1", "", "   ", "b:2]"))).state.doc.toString()).toBe(lines("//a:1", "", "   ", "//b:2"));
    const lone = press(make(lines("a:1", "|", "b:2")));
    expect(lone.changed).toBe(false);
    expect(lone.handled).toBe(true);
  });

  it("equivalence with the rows: toggled lines are disabled rows; re-enabled rows serialize clean", () => {
    const toggled = press(make(lines('[order:{"a":1}', "site:shop", "x:1]", "keep:me"))).state.doc.toString();
    expect(toggled).toBe(serializeRows(parseBulk(toggled))); // exactly the serializer's own form
    const rows = parseBulk(toggled);
    expect(rows).toEqual([
      { key: "order", value: '{"a":1}', enabled: false },
      { key: "site", value: "shop", enabled: false },
      { key: "x", value: "1", enabled: false },
      { key: "keep", value: "me", enabled: true },
    ]);
    // Re-enabled in the table (checkbox) → the bulk lines have no "//" any more.
    expect(serializeRows(rows.map((r) => ({ ...r, enabled: true })))).toBe(lines('order:{"a":1}', "site:shop", "x:1", "keep:me"));
  });
});

describe("Ctrl+/ everywhere else", () => {
  it("is swallowed with no change (raw body, URL bar, cells, auth fields)", () => {
    for (const doc of ['{"a": |1}', "https://x.io/|a", lines("[a:1", "b:2]")]) {
      const r = press(make(doc, false));
      expect(r.changed).toBe(false);
      expect(r.handled).toBe(true); // handled = basicSetup's own Mod-/ never runs
    }
  });
});
