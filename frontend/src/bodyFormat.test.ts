import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState, Extension } from "@codemirror/state";
import { history, undo, undoDepth } from "@codemirror/commands";
import { formatGate, whitespaceChanges } from "./bodyFormat";
import { bodyFormatter, bulkEditorExtension, formatBodyKey, formatTransaction } from "./codemirror";

// Go's output for these inputs (internal/jsonfmt tests pin the formatting itself).
const MIN = `{"a":{{n}},"b":"{{tok}}","c":[{{x}},2]}`;
const PRETTY = '{\n  "a": {{n}},\n  "b": "{{tok}}",\n  "c": [\n    {{x}},\n    2\n  ]\n}';

describe("Format gate (button + key)", () => {
  const body = (type: string, content_type: string, content = '{"a":1}') => ({ type, content_type, content });
  it("raw + a JSON content type + something to format", () => {
    expect(formatGate(body("raw", "application/json"))).toEqual({ enabled: true, reason: "Format JSON (Ctrl+Shift+F)" });
    expect(formatGate(body("raw", "application/vnd.api+json")).enabled).toBe(true);
    expect(formatGate(body("raw", "Application/JSON; charset=utf-8")).enabled).toBe(true);
  });
  it("disabled (with a reason) for other types, modes and an empty body", () => {
    expect(formatGate(body("raw", "text/plain"))).toEqual({ enabled: false, reason: "Format needs a JSON content type" });
    expect(formatGate(body("raw", ""))).toMatchObject({ enabled: false });
    expect(formatGate(body("form", "application/json"))).toEqual({ enabled: false, reason: "Format applies to a raw JSON body" });
    expect(formatGate(body("none", "application/json")).enabled).toBe(false);
    expect(formatGate(body("raw", "application/json", "  \n"))).toEqual({ enabled: false, reason: "Nothing to format" });
  });
});

describe("whitespace-only changes", () => {
  it("rewrites only whitespace runs, leaving the rest (and spaces inside strings) alone", () => {
    const ch = whitespaceChanges('{"a b":1}', '{\n  "a b": 1\n}')!;
    expect(ch).toEqual([
      { from: 1, to: 1, insert: "\n  " },
      { from: 7, to: 7, insert: " " },
      { from: 8, to: 8, insert: "\n" },
    ]);
    expect(whitespaceChanges(PRETTY, PRETTY)).toEqual([]);
  });
  it("null when anything but whitespace differs", () => {
    expect(whitespaceChanges('{"a":1}', '{"a":2}')).toBeNull();
    expect(whitespaceChanges('{"a":1}', '{"a":1}x')).toBeNull();
    expect(whitespaceChanges('{"a":1}x', '{"a":1}')).toBeNull();
  });
});

describe("format transaction", () => {
  const state = (doc: string, cursor = 0) =>
    EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [history()] });

  it("one undo step restores the exact original; the cursor stays by its token", () => {
    const at = MIN.indexOf("{{tok}}");
    const s0 = state(MIN, at);
    const s1 = s0.update(formatTransaction(s0, MIN, PRETTY)!).state;
    expect(s1.doc.toString()).toBe(PRETTY);
    expect(s1.selection.main.head).toBe(PRETTY.indexOf("{{tok}}")); // no jump to the start
    expect(undoDepth(s1)).toBe(1);
    let s2 = s1;
    undo({ state: s1, dispatch: (tr) => (s2 = tr.state) });
    expect(s2.doc.toString()).toBe(MIN);
    expect(undoDepth(s2)).toBe(0);
  });
  it("its own undo step even right after typing", () => {
    let s = state("", 0);
    s = s.update({ changes: { from: 0, insert: MIN }, userEvent: "input.type" }).state;
    s = s.update(formatTransaction(s, MIN, PRETTY)!).state;
    expect(undoDepth(s)).toBe(2);
  });
  it("nothing when the text moved on while Go formatted, or nothing changes", () => {
    expect(formatTransaction(state(MIN + " "), MIN, PRETTY)).toBeNull();
    expect(formatTransaction(state(PRETTY), PRETTY, PRETTY)).toBeNull();
  });
  it("keeps the trailing newline state Go returns (never added or removed here)", () => {
    const s0 = state('{"a":1}\n');
    expect(s0.update(formatTransaction(s0, '{"a":1}\n', '{\n  "a": 1\n}\n')!).state.doc.toString()).toBe('{\n  "a": 1\n}\n');
  });
});

describe("Ctrl/Cmd+Shift+F gating", () => {
  const press = (extensions: Extension) => {
    const s = EditorState.create({ doc: MIN, extensions });
    return formatBodyKey({ state: s, dispatch: () => undefined });
  };
  it("runs the raw JSON body's formatter", () => {
    const fn = vi.fn();
    expect(press(bodyFormatter.of(fn))).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("a swallowed no-op without one: non-JSON body, bulk editors", () => {
    expect(press(bodyFormatter.of(null))).toBe(true);
    expect(press(bulkEditorExtension)).toBe(true);
  });
});
