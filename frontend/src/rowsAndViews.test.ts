import { describe, expect, it } from "vitest";
import { appendRowKey, commitOnLeave, DraftField, EMPTY_DRAFT, VarDraft } from "./envRows";
import { effectiveView, ResponseLike } from "./responseView";
import {
  BodyChoice, DEFAULT_BODY_CHOICE, DEFAULT_HISTORY_CHOICE, HistoryChoice, shownHistorySection, shownPart, shownResponseSection,
  shownTextView,
} from "./viewChoice";

const key = (k: string, mods: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) =>
  ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });

describe("env append row: keys", () => {
  const typed: VarDraft = { key: "BASE_URL", type: "regular", value: "" };
  const fields: DraftField[] = ["key", "type", "value"];

  it("Tab moves through key → type → value natively; Tab from the value creates and goes to the next row's key", () => {
    // [field, Tab?, Shift+Tab?] — native means the browser's own focus order inside the row.
    const matrix: [DraftField, string, string][] = [
      ["key", "native", "native"],
      ["type", "native", "native"],
      ["value", "commit-next", "native"],
    ];
    for (const [f, tab, shiftTab] of matrix) {
      expect(appendRowKey(f, key("Tab"), typed), `Tab on ${f}`).toBe(tab);
      expect(appendRowKey(f, key("Tab", { shiftKey: true }), typed), `Shift+Tab on ${f}`).toBe(shiftTab);
    }
  });

  it("Enter creates from any field; nothing happens without a key (Tab / Enter stay native)", () => {
    for (const f of fields) {
      expect(appendRowKey(f, key("Enter"), typed)).toBe("commit-next");
      expect(appendRowKey(f, key("Enter"), { ...EMPTY_DRAFT, value: "orphan" })).toBe("native");
      expect(appendRowKey(f, key("Tab"), { ...EMPTY_DRAFT, key: "   " })).toBe("native");
    }
  });

  it("Escape clears a started draft; modified keys are never ours", () => {
    expect(appendRowKey("value", key("Escape"), typed)).toBe("clear");
    expect(appendRowKey("value", key("Escape"), EMPTY_DRAFT)).toBe("native");
    expect(appendRowKey("value", key("Tab", { ctrlKey: true }), typed)).toBe("native");
    expect(appendRowKey("key", key("Enter", { altKey: true }), typed)).toBe("native");
  });

  it("committing the key alone never happens inside the row: only leaving it (with a key) creates", () => {
    expect(commitOnLeave(typed, true)).toBe(false); // key → type: same row, no create, no re-render
    expect(commitOnLeave(typed, false)).toBe(true); // clicked / Shift+Tabbed out of the row
    expect(commitOnLeave(EMPTY_DRAFT, false)).toBe(false);
  });

  it("keyboard-only creation of three variables: key, Tab, type, Tab, value, Tab → three creates in order", () => {
    const created: VarDraft[] = [];
    let draft = EMPTY_DRAFT;
    const press = (f: DraftField, k: string) => {
      if (appendRowKey(f, key(k), draft) === "commit-next") {
        created.push(draft);
        draft = EMPTY_DRAFT; // the row is free again; focus is back on its key
      }
    };
    for (const [k, t, v] of [["A", "regular", "1"], ["B", "secret", "s"], ["C", "regular", "3"]]) {
      draft = { ...draft, key: k };
      press("key", "Tab");
      draft = { ...draft, type: t };
      press("type", "Tab");
      draft = { ...draft, value: v };
      press("value", "Tab");
    }
    expect(created).toEqual([
      { key: "A", type: "regular", value: "1" },
      { key: "B", type: "secret", value: "s" },
      { key: "C", type: "regular", value: "3" },
    ]);
  });
});

// A history entry as the detail sees it.
interface Entry { response: boolean; console: number; pretty: boolean }

const shownHistory = (c: HistoryChoice, e: Entry) => ({
  section: shownHistorySection(c.section, e.console),
  form: c.form,
  part: shownPart(c.part, e.response),
  body: shownTextView(c.body, e.pretty),
});

describe("sticky view choices: walks over items", () => {
  it("history: Headers + Resolved persist over 5 entries; an ERR entry falls back; the next one is back", () => {
    let choice: HistoryChoice = DEFAULT_HISTORY_CHOICE;
    choice = { ...choice, part: "headers" }; // the user picks Headers …
    choice = { ...choice, form: "resolved" }; // … and Resolved (on the Request section)
    const ok: Entry = { response: true, console: 0, pretty: true };
    for (let i = 0; i < 5; i++) expect(shownHistory(choice, ok)).toMatchObject({ section: "response", part: "headers", form: "resolved" });
    const err: Entry = { response: false, console: 0, pretty: false };
    expect(shownHistory(choice, err)).toMatchObject({ part: "body", form: "resolved" }); // the "no response" note
    expect(choice.part).toBe("headers"); // the fallback never touched the choice
    expect(shownHistory(choice, ok).part).toBe("headers");
  });

  it("history: Console needs output; Raw / Pretty follow the body", () => {
    const choice: HistoryChoice = { ...DEFAULT_HISTORY_CHOICE, section: "console" };
    expect(shownHistory(choice, { response: true, console: 0, pretty: true }).section).toBe("response");
    expect(shownHistory(choice, { response: true, console: 3, pretty: true }).section).toBe("console");
    expect(shownHistory(DEFAULT_HISTORY_CHOICE, { response: true, console: 0, pretty: false }).body).toBe("raw");
    expect(shownHistory(DEFAULT_HISTORY_CHOICE, { response: true, console: 0, pretty: true }).body).toBe("pretty");
    const raw: HistoryChoice = { ...DEFAULT_HISTORY_CHOICE, body: "raw" };
    expect(shownHistory(raw, { response: true, console: 0, pretty: true }).body).toBe("raw");
  });

  it("captures: Headers and Raw persist; a capture without a Pretty form shows Raw, the next JSON one Pretty again", () => {
    let c: BodyChoice = DEFAULT_BODY_CHOICE;
    expect(shownTextView(c.body, false)).toBe("raw");
    expect(shownTextView(c.body, true)).toBe("pretty");
    c = { ...c, part: "headers", body: "raw" };
    for (const pretty of [true, false, true]) {
      expect(shownPart(c.part, true)).toBe("headers");
      expect(shownTextView(c.body, pretty)).toBe("raw");
    }
  });

  it("examples: a chosen Preview / Raw sticks where the example supports it", () => {
    const json: ResponseLike = { contentType: "application/json", formatted: true, body: "{}", rawBody: "{}" };
    const html: ResponseLike = { contentType: "text/html", formatted: false, body: "<p>", rawBody: "" };
    const text: ResponseLike = { contentType: "text/plain", formatted: false, body: "hi", rawBody: "" };
    let c: BodyChoice = DEFAULT_BODY_CHOICE;
    expect([json, html, text].map((e) => effectiveView(e, c.body))).toEqual(["pretty", "preview", "raw"]); // each its default
    c = { ...c, body: "raw" };
    expect([json, html, text].map((e) => effectiveView(e, c.body))).toEqual(["raw", "raw", "raw"]);
    c = { ...c, body: "preview" };
    expect([html, json, html].map((e) => effectiveView(e, c.body))).toEqual(["preview", "pretty", "preview"]); // back
  });

  it("response pane: Console stays chosen across a send without output and returns with the next", () => {
    expect(shownResponseSection("console", 0)).toBe("body");
    expect(shownResponseSection("console", 2)).toBe("console");
    expect(shownResponseSection("headers", 0)).toBe("headers"); // switching sub-tabs never touches responseView
  });
});
