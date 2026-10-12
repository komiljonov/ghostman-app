import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { singleLineFilter } from "./codemirror";

// A paste into a line editor (URL bar, table cells, auth fields): replaces the
// selection [from, to) with `text`, like CodeMirror's paste handler.
function paste(doc: string, from: number, to: number, text: string) {
  const s = EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: [singleLineFilter] });
  const state = s.update(s.replaceSelection(text), { userEvent: "input.paste" }).state;
  return { doc: state.doc.toString(), cursor: state.selection.main.head };
}

describe("line editors drop line breaks from pasted text", () => {
  it("a URL copied with a trailing newline (used to throw and lose the paste)", () => {
    expect(paste("", 0, 0, "https://httpbin.org/get?a=1\n")).toEqual({ doc: "https://httpbin.org/get?a=1", cursor: 27 });
    expect(paste("", 0, 0, "https://httpbin.org/get?a=1\r\n")).toEqual({ doc: "https://httpbin.org/get?a=1", cursor: 27 });
  });
  it("over a selection, and with a break in the middle", () => {
    expect(paste("{{BASE_URL}}/post?page=2", 0, 24, "https://httpbin.org/anything?q=1\n"))
      .toEqual({ doc: "https://httpbin.org/anything?q=1", cursor: 32 });
    expect(paste("", 0, 0, "https://httpbin.org/get\r\n?a=1&b=2")).toEqual({ doc: "https://httpbin.org/get?a=1&b=2", cursor: 31 });
  });
  it("the cursor lands right after the pasted text, not past it", () => {
    expect(paste("https://x.io/get", 0, 0, "https://a.io\n")).toEqual({ doc: "https://a.iohttps://x.io/get", cursor: 12 });
    expect(paste("https://httpbin.org/get", 19, 19, "\n/anything\n")).toEqual({ doc: "https://httpbin.org/anything/get", cursor: 28 });
  });
  it("text without line breaks passes through unchanged", () => {
    expect(paste("", 0, 0, "https://httpbin.org/get?a=1")).toEqual({ doc: "https://httpbin.org/get?a=1", cursor: 27 });
  });
});
