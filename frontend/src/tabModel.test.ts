import { describe, expect, it } from "vitest";
import { canSendShortcut, dropSlot, ENV_LIST, isSendShortcut, normalizeSaved, reorder, syncEnvTabs, tabKey } from "./tabModel";

describe("tab persistence format", () => {
  it("migrates the old bare-id format to request tabs", () => {
    expect(normalizeSaved({ open: ["r1", "r2"], active: "r2" })).toEqual({
      open: [{ kind: "request", id: "r1" }, { kind: "request", id: "r2" }],
      active: { kind: "request", id: "r2" },
    });
  });
  it("reads the typed format and keeps order", () => {
    const saved = { open: [{ kind: "env", id: "e1" }, { kind: "request", id: "r1" }, { kind: "env_list", id: "" }], active: { kind: "env", id: "e1" } };
    expect(normalizeSaved(saved)).toEqual(saved);
  });
  it("tolerates garbage: unknown kinds, empty ids, duplicates, null, a stale active", () => {
    expect(normalizeSaved({
      open: ["r1", { kind: "request", id: "r1" }, { kind: "bogus", id: "x" }, { kind: "env", id: "" }, 42, null, ""],
      active: { kind: "request", id: "gone" },
    })).toEqual({ open: [{ kind: "request", id: "r1" }], active: undefined });
    expect(normalizeSaved(null)).toEqual({ open: [], active: undefined });
    expect(normalizeSaved({ open: "nope" })).toEqual({ open: [], active: undefined });
  });
  it("keys are unique per kind", () => {
    expect(tabKey({ kind: "request", id: "x" })).not.toBe(tabKey({ kind: "env", id: "x" }));
    expect(tabKey(ENV_LIST)).toBe("env_list:");
  });
});

describe("reorder (drag & drop)", () => {
  const tabs = ["a", "b", "c", "d"];
  it("moves the third tab to the front", () => {
    expect(reorder(tabs, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });
  it("moves forward: slot counts original positions", () => {
    expect(reorder(tabs, 0, 2)).toEqual(["b", "a", "c", "d"]);
    expect(reorder(tabs, 0, 4)).toEqual(["b", "c", "d", "a"]);
  });
  it("dropping onto itself (either side) changes nothing", () => {
    expect(reorder(tabs, 1, 1)).toBe(tabs);
    expect(reorder(tabs, 1, 2)).toBe(tabs);
  });
  it("clamps out-of-range slots and ignores bad sources", () => {
    expect(reorder(tabs, 3, -5)).toEqual(["d", "a", "b", "c"]);
    expect(reorder(tabs, 9, 0)).toBe(tabs);
  });
  it("finds the slot from tab midpoints", () => {
    const rects = [{ left: 0, right: 100 }, { left: 100, right: 200 }, { left: 200, right: 300 }];
    expect([dropSlot(10, rects), dropSlot(60, rects), dropSlot(149, rects), dropSlot(260, rects), dropSlot(999, rects)])
      .toEqual([0, 1, 1, 3, 3]);
  });
});

describe("Ctrl+Enter dispatch", () => {
  it("sends for an idle request tab", () => {
    expect(canSendShortcut({ activeKind: "request", modalOpen: false, sending: false })).toBe(true);
  });
  it("does nothing on env tabs, with no tab, with a modal open, or while sending", () => {
    expect(canSendShortcut({ activeKind: "env", modalOpen: false, sending: false })).toBe(false);
    expect(canSendShortcut({ activeKind: "env_list", modalOpen: false, sending: false })).toBe(false);
    expect(canSendShortcut({ activeKind: undefined, modalOpen: false, sending: false })).toBe(false);
    expect(canSendShortcut({ activeKind: "request", modalOpen: true, sending: false })).toBe(false);
    expect(canSendShortcut({ activeKind: "request", modalOpen: false, sending: true })).toBe(false);
  });
  it("recognizes Ctrl+Enter and Cmd+Enter only", () => {
    const k = (o: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) =>
      isSendShortcut({ key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
    expect([k({ ctrlKey: true }), k({ metaKey: true }), k({}), k({ ctrlKey: true, shiftKey: true }), k({ key: "a", ctrlKey: true })])
      .toEqual([true, true, false, false, false]);
  });
});

describe("environment tabs follow the environment list", () => {
  it("relabels renamed envs and closes deleted ones; other tabs untouched", () => {
    const tabs = [
      { ref: { kind: "env" as const, id: "e1" }, name: "dev" },
      { ref: { kind: "env" as const, id: "e2" }, name: "prod" },
      { ref: { kind: "request" as const, id: "e2" }, name: "a request" },
      { ref: ENV_LIST, name: "Environments" },
    ];
    expect(syncEnvTabs(tabs, [{ id: "e1", name: "development" }])).toEqual({
      rename: [{ ref: { kind: "env", id: "e1" }, name: "development" }],
      close: [{ kind: "env", id: "e2" }],
    });
  });
});
