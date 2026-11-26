// Keyboard rules of the env variables table's append row (NewVariableRow). The row
// is complete from the start — key · type · value · actions, like a saved row — and
// it is a DRAFT until it is committed as a whole: typing the key, Tab to the type,
// Tab to the value never creates anything yet, so focus never jumps.
//   Enter (any field) / Tab from the value  → create, then focus the next (new
//                                              empty) row's key
//   focus leaving the row (click, Shift+Tab out) → create; focus stays where it went
//   Escape                                   → clear the draft
// Everything else is the browser's own (Tab key → type → value, Shift+Tab back).

export type DraftField = "key" | "type" | "value";

export interface VarDraft {
  key: string;
  type: string; // regular | secret
  value: string;
}

export const EMPTY_DRAFT: VarDraft = { key: "", type: "regular", value: "" };

export type DraftKeyAction = "commit-next" | "clear" | "native";

interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export const hasKey = (d: VarDraft) => d.key.trim() !== "";

export function appendRowKey(field: DraftField, e: KeyLike, draft: VarDraft): DraftKeyAction {
  if (e.altKey || e.ctrlKey || e.metaKey) return "native";
  if (e.key === "Escape") return hasKey(draft) || draft.value !== "" ? "clear" : "native";
  if (!hasKey(draft)) return "native"; // nothing to create: Tab / Enter behave normally
  if (e.key === "Enter" && !e.shiftKey) return "commit-next";
  if (e.key === "Tab" && !e.shiftKey && field === "value") return "commit-next";
  return "native";
}

// Focus left the row (relatedTarget outside it, or nowhere): a draft with a key is created.
export const commitOnLeave = (draft: VarDraft, focusStaysInRow: boolean) => !focusStaysInRow && hasKey(draft);
