import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editRow, newRow, removeRow, Row, toggleRow } from "./rows";
import { createAutosaver, SaveState } from "./autosave";
import { restoreTabs, saveTabs, SavedTabs, TabStorage } from "./tabPersistence";

describe("row table", () => {
  const rows: Row[] = [newRow({ key: "a", value: "1" }), newRow({ key: "b", value: "2", enabled: false })];

  it("typing into the trailing ghost row appends a real row", () => {
    const next = editRow(rows, 2, { key: "c" });
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ key: "c", value: "", enabled: true });
    expect(rows).toHaveLength(2); // not mutated
  });

  it("editing an existing row updates it in place, order kept", () => {
    expect(editRow(rows, 0, { value: "9" }).map((r) => `${r.key}=${r.value}`)).toEqual(["a=9", "b=2"]);
  });

  it("toggles enabled; the ghost row cannot be toggled", () => {
    expect(toggleRow(rows, 1)[1].enabled).toBe(true);
    expect(toggleRow(rows, 0)[0].enabled).toBe(false);
    expect(toggleRow(rows, 2)).toBe(rows);
  });

  it("removes rows; duplicates are allowed and stay independent", () => {
    const dup = [newRow({ key: "k", value: "1" }), newRow({ key: "k", value: "2" })];
    expect(removeRow(dup, 0)).toEqual([newRow({ key: "k", value: "2" })]);
    expect(removeRow(dup, 5)).toBe(dup);
  });
});

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(results: boolean[] = []) {
    const states: SaveState[] = [];
    let calls = 0;
    const gates: (() => void)[] = [];
    const saver = createAutosaver({
      delayMs: 600,
      onState: (s) => states.push(s),
      save: () => {
        calls++;
        const ok = results.shift() ?? true;
        return new Promise<boolean>((resolve) => gates.push(() => resolve(ok)));
      },
    });
    const finishSave = async () => {
      gates.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    };
    return { saver, states, calls: () => calls, finishSave };
  }

  it("debounces: many edits within 600ms produce one save", async () => {
    const { saver, calls, finishSave, states } = setup();
    saver.change();
    await vi.advanceTimersByTimeAsync(300);
    saver.change();
    await vi.advanceTimersByTimeAsync(599);
    expect(calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(1);
    await finishSave();
    expect(states.at(-1)).toBe("saved");
  });

  it("flush on close saves immediately without waiting for the debounce", async () => {
    const { saver, calls, finishSave } = setup();
    saver.change();
    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    await finishSave();
    await flushed;
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(1); // the cancelled debounce does not fire a second save
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("flush with nothing unsaved does nothing", async () => {
    const { saver, calls } = setup();
    await saver.flush();
    expect(calls()).toBe(0);
  });

  it("never overlaps saves; edits during a save are saved afterwards (last write wins)", async () => {
    const { saver, calls, finishSave, states } = setup();
    saver.change();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls()).toBe(1);
    saver.change(); // edit while the first save is in flight
    await vi.advanceTimersByTimeAsync(600);
    expect(calls()).toBe(1); // still waiting for the first one
    await finishSave();
    expect(calls()).toBe(2);
    await finishSave();
    expect(states.at(-1)).toBe("saved");
  });

  it("keeps edits on failure and retry saves them", async () => {
    const { saver, calls, finishSave, states } = setup([false, true]);
    saver.change();
    await vi.advanceTimersByTimeAsync(600);
    await finishSave();
    expect(states.at(-1)).toBe("error");
    expect(saver.hasUnsaved()).toBe(true);
    const retried = saver.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(2);
    await finishSave();
    await retried;
    expect(states.at(-1)).toBe("saved");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("dispose drops pending work", async () => {
    const { saver, calls } = setup();
    saver.change();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(0);
  });
});

describe("tab persistence", () => {
  function memoryStorage(initial: Record<string, SavedTabs> = {}) {
    const data = { ...initial };
    const storage: TabStorage = {
      get: async (p) => data[p] ?? { open: [], active: "" },
      set: vi.fn(async (p: string, t: SavedTabs) => {
        data[p] = t;
      }),
    };
    return { storage, data };
  }

  it("round-trips open tabs and the active tab per project", async () => {
    const { storage } = memoryStorage();
    await saveTabs(storage, "p1", ["r1", "r2"], "r2");
    await saveTabs(storage, "p2", ["x"], "x");
    expect(await restoreTabs(storage, "p1", async () => true)).toEqual({ open: ["r1", "r2"], active: "r2" });
    expect(await restoreTabs(storage, "p2", async () => true)).toEqual({ open: ["x"], active: "x" });
  });

  it("an active id that is not open is not stored", async () => {
    const { storage, data } = memoryStorage();
    await saveTabs(storage, "p1", ["r1"], "gone");
    expect(data.p1).toEqual({ open: ["r1"], active: "" });
  });

  it("silently drops requests that no longer exist and writes the cleaned list back", async () => {
    const { storage, data } = memoryStorage({ p1: { open: ["r1", "deleted", "r3"], active: "deleted" } });
    const restored = await restoreTabs(storage, "p1", async (id) => id !== "deleted");
    expect(restored).toEqual({ open: ["r1", "r3"], active: "r3" });
    expect(data.p1).toEqual({ open: ["r1", "r3"], active: "r3" });
  });

  it("a failing load counts as gone", async () => {
    const { storage } = memoryStorage({ p1: { open: ["r1"], active: "r1" } });
    expect(await restoreTabs(storage, "p1", async () => Promise.reject(new Error("x")))).toEqual({ open: [], active: "" });
  });
});
