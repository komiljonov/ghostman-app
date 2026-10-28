import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExampleEditSaver, createSaveFlow, exampleMeta, examplesTabLabel, ExampleForm, ExampleInputWire, formStatus, moveState,
  SaveDialogState,
} from "./examplesModel";
import { exampleCount, examplesChanged, examplesTick, setExampleCount } from "./examplesStore";

const TOO_LARGE = "response too large for an example (1MB limit) — use Save to file";

describe("save as example: the dialog flow", () => {
  it("prepare → default name → edit → save → saved, then the list is told", async () => {
    const states: SaveDialogState[] = [];
    const saved: string[] = [];
    const save = vi.fn(async (name: string) => ({ data: { id: "e1", name: name.trim() } }));
    const flow = createSaveFlow({
      prepare: async () => ({ data: { default_name: "200 response", size: 429 } }),
      save, onSaved: (e) => saved.push(e.id),
    }, (s) => states.push(s));
    await flow.start();
    expect(flow.state()).toEqual({ kind: "ready", name: "200 response", saving: false });
    flow.setName("Happy path");
    expect(flow.canSave()).toBe(true);
    await flow.save();
    expect(save).toHaveBeenCalledWith("Happy path");
    expect(flow.state()).toEqual({ kind: "saved", name: "Happy path" });
    expect(saved).toEqual(["e1"]);
    expect(states.map((s) => s.kind)).toEqual(["preparing", "ready", "ready", "ready", "saved"]);
  });

  it("a too-large response is refused up front: no name, no save", async () => {
    const save = vi.fn();
    const flow = createSaveFlow({
      prepare: async () => ({ error: { message: TOO_LARGE, code: "example_too_large" } }),
      save, onSaved: () => undefined,
    }, () => undefined);
    await flow.start();
    expect(flow.state()).toEqual({ kind: "refused", message: TOO_LARGE });
    expect(flow.canSave()).toBe(false);
    await flow.save();
    flow.setName("x");
    expect(save).not.toHaveBeenCalled();
    expect(flow.state().kind).toBe("refused");
  });

  it("a server error keeps the dialog open with the name; an empty name can't be saved; no double save", async () => {
    let calls = 0;
    let release!: () => void;
    const flow = createSaveFlow({
      prepare: async () => ({ data: { default_name: "404 response", size: 1 } }),
      save: async () => {
        calls++;
        await new Promise<void>((r) => (release = r));
        return { error: { message: "the request this response belongs to no longer exists" } };
      },
      onSaved: () => undefined,
    }, () => undefined);
    await flow.start();
    flow.setName("  ");
    expect(flow.canSave()).toBe(false);
    flow.setName("Gone");
    const first = flow.save();
    void flow.save(); // while saving: ignored
    expect(flow.canSave()).toBe(false);
    release();
    await first;
    expect(calls).toBe(1);
    expect(flow.state()).toEqual({ kind: "ready", name: "Gone", saving: false, error: "the request this response belongs to no longer exists" });
    flow.setName("Gone 2"); // typing clears the error
    expect(flow.state()).toMatchObject({ error: undefined });
  });
});

describe("edit mode: the autosave wiring", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces, sends the CURRENT form, keeps a binary body out, falls back to the saved status", async () => {
    let form: ExampleForm = { name: "Happy", status: "200", headers: [], content_type: "application/json", body: '{"a":1}' };
    const sent: ExampleInputWire[] = [];
    const states: string[] = [];
    const saver = createExampleEditSaver(() => form, {
      update: async (next) => {
        sent.push(next);
        return {};
      },
      onState: (s) => states.push(s),
      savedStatus: () => 200,
    });
    form = { ...form, status: "20" }; // mid-typing: invalid
    saver.change();
    form = { ...form, status: "201", body: '{"a":2}' };
    saver.change();
    await vi.advanceTimersByTimeAsync(599);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([{ name: "Happy", status: 201, headers: [], content_type: "application/json", body: '{"a":2}' }]);

    form = { ...form, status: "9", body: null }; // invalid status, body not editable
    saver.change();
    await vi.advanceTimersByTimeAsync(600);
    expect(sent[1]).toMatchObject({ status: 200, body: null });
    expect(states.at(-1)).toBe("saved");
  });

  it("a failed PATCH keeps the edits, reports the message and retries", async () => {
    const form: ExampleForm = { name: "x", status: "200", headers: [], content_type: "", body: "" };
    const errors: (string | undefined)[] = [];
    let fail = true;
    const update = vi.fn(async () => (fail ? { error: { message: "status must be between 100 and 599" } } : {}));
    const saver = createExampleEditSaver(() => form, { update, onState: (s, e) => s === "error" && errors.push(e), savedStatus: () => 200 });
    saver.change();
    await vi.advanceTimersByTimeAsync(600);
    expect(errors).toContain("status must be between 100 and 599");
    expect(saver.hasUnsaved()).toBe(true);
    fail = false;
    await saver.retry();
    expect(update).toHaveBeenCalledTimes(2);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("status parsing", () => {
    expect(formStatus("201")).toBe(201);
    expect(formStatus(" 404 ")).toBe(404);
    for (const s of ["", "99", "600", "2o0", "2000", "20"]) expect(formStatus(s)).toBeUndefined();
  });
});

describe("list and badge", () => {
  it("tab label, row meta, move availability", () => {
    expect(examplesTabLabel(undefined)).toBe("Examples");
    expect(examplesTabLabel(0)).toBe("Examples (0)");
    expect(examplesTabLabel(2)).toBe("Examples (2)");
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(exampleMeta({ id: "e", name: "n", status: 200, content_type: "", body_size: 2048, updated_at: "2026-10-28T09:55:00Z" }, now))
      .toEqual({ contentType: "no Content-Type", size: "2.0 KB", updated: "5m ago" });
    expect(moveState(0, 3)).toEqual({ up: false, down: true });
    expect(moveState(2, 3)).toEqual({ up: true, down: false });
    expect(moveState(0, 1)).toEqual({ up: false, down: false });
  });

  it("the badge count follows GetRequest and every list fetch; a save ticks open panels", () => {
    expect(exampleCount("r1")).toBeUndefined();
    setExampleCount("r1", 0); // from GetRequest example_count
    expect(exampleCount("r1")).toBe(0);
    const before = examplesTick();
    examplesChanged(); // saved from the response pane
    expect(examplesTick()).toBe(before + 1);
    setExampleCount("r1", 1); // the panel's re-fetch
    expect(exampleCount("r1")).toBe(1);
    expect(examplesTabLabel(exampleCount("r1"))).toBe("Examples (1)");
  });
});
