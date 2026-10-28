// Saved response examples: the save dialog's flow, the edit form's autosave
// wiring and the list's labels. What an example IS (cap, default name, body
// handling) is Go (examples.go); this file only sequences the bound calls the
// views make. Pure — unit-tested in examples.test.ts (fake bound calls, fake timers).
import { createAutosaver, SaveState } from "./autosave";
import { formatBytes } from "./historyModel";
import type { Row } from "./rows";
import { relativeTime } from "./webhookModel";

export const EXAMPLE_SYNC_NOTICE = "Examples sync to your team — check the body for secrets before saving.";

// "Examples" / "Examples (3)" — the request editor's sub-tab.
export const examplesTabLabel = (count: number | undefined) => (count === undefined ? "Examples" : `Examples (${count})`);

export interface ExampleRow {
  id: string;
  name: string;
  status: number;
  content_type: string;
  body_size: number;
  updated_at: string;
}

// The list row's muted facts: type · size · updated.
export const exampleMeta = (e: ExampleRow, now: number) => ({
  contentType: e.content_type || "no Content-Type",
  size: formatBytes(e.body_size),
  updated: relativeTime(e.updated_at, now),
});

// ↑ / ↓ on a row (the first can't go up, the last can't go down).
export const moveState = (index: number, count: number) => ({ up: index > 0, down: index < count - 1 });

// ---- Save as example (response pane, history detail) ----

export interface Problem {
  message: string;
  code?: string;
}

export interface SaveDeps {
  prepare: () => Promise<{ data?: { default_name: string; size: number }; error?: Problem }>;
  save: (name: string) => Promise<{ data?: { id: string; name: string }; error?: Problem }>;
  onSaved: (example: { id: string; name: string }) => void; // re-fetch the list / badge
}

export type SaveDialogState =
  | { kind: "preparing" }
  | { kind: "refused"; message: string } // too large / nothing to save: no name field, no Save
  | { kind: "ready"; name: string; error?: string; saving: boolean }
  | { kind: "saved"; name: string };

// The dialog's state machine: prepare (Go decides the default name or refuses)
// → edit the name → save. A server error keeps the dialog open with the name.
export function createSaveFlow(deps: SaveDeps, onChange: (s: SaveDialogState) => void) {
  let state: SaveDialogState = { kind: "preparing" };
  const set = (s: SaveDialogState) => {
    state = s;
    onChange(s);
  };
  return {
    state: () => state,
    async start() {
      set({ kind: "preparing" });
      const r = await deps.prepare();
      set(r.data ? { kind: "ready", name: r.data.default_name, saving: false } : { kind: "refused", message: r.error?.message ?? "nothing to save" });
    },
    setName(name: string) {
      if (state.kind === "ready") set({ ...state, name, error: undefined });
    },
    canSave: () => state.kind === "ready" && !state.saving && state.name.trim() !== "",
    async save() {
      if (state.kind !== "ready" || state.saving || state.name.trim() === "") return;
      const name = state.name;
      set({ ...state, saving: true, error: undefined });
      const r = await deps.save(name);
      if (r.data) {
        set({ kind: "saved", name: r.data.name });
        deps.onSaved(r.data);
      } else {
        set({ kind: "ready", name, saving: false, error: r.error?.message ?? "could not save the example" });
      }
    },
  };
}

// ---- Edit mode ----

export interface ExampleForm {
  name: string;
  status: string; // as typed; an invalid one is left out of the save
  headers: Row[];
  content_type: string;
  body: string | null; // null = not editable / not loaded: never sent
}

export interface ExampleInputWire {
  name: string;
  status: number;
  headers: Row[];
  content_type: string;
  body: string | null;
}

// A status the form can save (100–599), else undefined.
export function formStatus(s: string): number | undefined {
  if (!/^\d{3}$/.test(s.trim())) return undefined;
  const n = Number(s.trim());
  return n >= 100 && n <= 599 ? n : undefined;
}

export interface EditDeps {
  update: (next: ExampleInputWire) => Promise<{ error?: Problem }>;
  onState: (s: SaveState, error?: string) => void;
  savedStatus: () => number; // what to send while the typed status is invalid
}

// The edit form's autosave (600 ms, one save in flight, last write wins —
// createAutosaver): every save sends the form's CURRENT state; Go diffs it
// against the server state and PATCHes the changed fields only.
export function createExampleEditSaver(form: () => ExampleForm, deps: EditDeps, delayMs = 600) {
  return createAutosaver({
    delayMs,
    onState: (s) => deps.onState(s),
    save: async () => {
      const f = form();
      const r = await deps.update({
        name: f.name, status: formStatus(f.status) ?? deps.savedStatus(), headers: f.headers,
        content_type: f.content_type, body: f.body,
      });
      if (r.error) deps.onState("error", r.error.message);
      return !r.error;
    },
  });
}
