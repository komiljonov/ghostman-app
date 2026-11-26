// View-mode choices are CONTAINER state (a tab), never item state: selecting
// another history entry, example or capture never resets them. A detail view
// SHOWS what the choice says when the item supports it and falls back when it
// does not (no response → no Headers; no script output → no Console; a body that
// is not JSON → no Pretty). The fallback is computed, never written back, so the
// next item that supports the choice shows it again. The choices live in the
// tab's TabState (tabsController) and end with the tab.
// Deliberate exception: a NEW SEND resets the live response pane's Pretty | Raw |
// Preview to that response's default (tabsController, commented there).
import type { BodyView } from "./responseView";

export type DetailPart = "body" | "headers";

// Body | Headers and the body view of a detail (example, capture, history entry).
export interface BodyChoice {
  part: DetailPart;
  body?: BodyView; // undefined = the item's own default
}

export type HistorySection = "request" | "response" | "timing" | "console";

// A history detail: its section and the Template | Resolved form, plus the body choice.
export interface HistoryChoice extends BodyChoice {
  section: HistorySection;
  form: "template" | "resolved";
}

export const DEFAULT_BODY_CHOICE: BodyChoice = { part: "body" };
export const DEFAULT_HISTORY_CHOICE: HistoryChoice = { section: "response", form: "template", part: "body" };

// Console needs script output: without it the history detail shows the Response.
export const shownHistorySection = (chosen: HistorySection, consoleCount: number): HistorySection =>
  chosen === "console" && consoleCount === 0 ? "response" : chosen;

// The live response pane's Body | Headers | Console: Console needs the last send's output.
export const shownResponseSection = (chosen: "body" | "headers" | "console", consoleCount: number) =>
  chosen === "console" && consoleCount === 0 ? "body" : chosen;

// Headers needs a response; without one the body slot shows the "no response" note.
export const shownPart = (chosen: DetailPart, hasResponse: boolean): DetailPart => (hasResponse ? chosen : "body");

// Pretty | Raw for history entries and captures: the chosen view (Pretty by default),
// Raw when the body has no Pretty form.
export const shownTextView = (chosen: BodyView | undefined, prettyOK: boolean): BodyView => {
  const v = chosen ?? "pretty";
  return v === "pretty" && !prettyOK ? "raw" : v;
};
