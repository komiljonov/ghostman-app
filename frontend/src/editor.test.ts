import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editRow, newRow, removeRow, Row, toggleRow } from "./rows";
import { createAutosaver, SaveState } from "./autosave";
import { createLayoutSaver, LayoutStorage, readLayout, restoreLayout, saveLayout } from "./layoutPersistence";
import { activeTab, allGroups, allTabs, singleGroup, splitGroup } from "./layoutTree";
import { isTabKey, refFromKey, type TabRef } from "./tabModel";

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

describe("layout persistence (per user + project, versioned)", () => {
  const req = (id: string): TabRef => ({ kind: "request", id });
  const mem = () => {
    const data = new Map<string, string>();
    const storage: LayoutStorage = {
      get: async (p) => data.get(p) ?? "",
      set: async (p, json) => void data.set(p, json),
    };
    return { data, storage };
  };
  const twoGroups = () => splitGroup(singleGroup(["request:r1", "env:e1", "request:r2"], "env:e1", "A"), "A", "right", "request:r2", "B");

  it("round-trips the whole layout, per project", async () => {
    const { storage, data } = mem();
    await saveLayout(storage, "p1", twoGroups());
    await saveLayout(storage, "p2", singleGroup(["request:x"], "request:x", "X"));
    expect(JSON.parse(data.get("p1")!).version).toBe(1);
    const p1 = await restoreLayout(storage, "p1", async () => true);
    expect(allGroups(p1.root).map((g) => g.tabs)).toEqual([["request:r1", "env:e1"], ["request:r2"]]);
    expect(p1.focusedGroupId).toBe("B");
    const p2 = await restoreLayout(storage, "p2", async () => true);
    expect(allTabs(p2.root)).toEqual(["request:x"]);
  });

  it("drops tabs whose target is gone, collapses their group, writes the cleaned layout back", async () => {
    const { storage, data } = mem();
    await saveLayout(storage, "p1", twoGroups());
    const l = await restoreLayout(storage, "p1", async (ref) => ref.id !== "r2");
    expect(allGroups(l.root).length).toBe(1);
    expect(allTabs(l.root)).toEqual(["request:r1", "env:e1"]);
    expect(allTabs(readLayout(data.get("p1")!)!.root)).toEqual(["request:r1", "env:e1"]);
    // A failing load counts as gone.
    const none = await restoreLayout(storage, "p1", async () => Promise.reject(new Error("x")));
    expect(allTabs(none.root)).toEqual([]);
  });

  it("corrupt data falls back to one empty group (and is overwritten), no crash", async () => {
    for (const raw of ["{not json", '{"version":9}', "[]", '{"version":1,"layout":{"root":{"type":"pane"}}}']) {
      const { storage, data } = mem();
      data.set("p1", raw);
      const l = await restoreLayout(storage, "p1", async () => true);
      expect(allGroups(l.root).length).toBe(1);
      expect(allTabs(l.root)).toEqual([]);
      expect(readLayout(data.get("p1")!)).not.toBeNull();
    }
    const { storage } = mem();
    expect(allTabs((await restoreLayout(storage, "p1", async () => true)).root)).toEqual([]); // nothing stored
  });

  it("reads the single group Go migrates from the old tab list", async () => {
    const { storage, data } = mem();
    data.set("p1", JSON.stringify({
      version: 1,
      layout: { root: { type: "group", id: "g-migrated", tabs: ["request:r1", "env_list:"], activeTabId: "request:r1" }, focusedGroupId: "g-migrated" },
    }));
    const l = await restoreLayout(storage, "p1", async () => true);
    expect(allTabs(l.root)).toEqual(["request:r1", "env_list:"]);
    expect(activeTab(l)).toBe("request:r1");
  });

  it("tab keys map back to refs", () => {
    expect(refFromKey("request:abc")).toEqual(req("abc"));
    expect(refFromKey("env_list:")).toEqual({ kind: "env_list", id: "" });
    expect(refFromKey("request:")).toBeUndefined();
    expect(isTabKey("bogus:x")).toBe(false);
  });

  it("the saver debounces and flushes", async () => {
    vi.useFakeTimers();
    let writes = 0;
    const saver = createLayoutSaver(async () => void writes++);
    saver.change();
    saver.change();
    vi.advanceTimersByTime(299);
    expect(writes).toBe(0);
    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(writes).toBe(1);
    saver.change();
    await saver.flush(); // quit: written now
    expect(writes).toBe(2);
    await saver.flush(); // nothing pending
    expect(writes).toBe(2);
    vi.useRealTimers();
  });
});
