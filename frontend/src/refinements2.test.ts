import { describe, expect, it, vi } from "vitest";
import { canUseTabShortcut, closeEach, cycleKey, shortcutAction, tabsToClose } from "./tabModel";
import { createThemeController, resolveTheme } from "./theme";
import { createFromTooltip, EnvDisplay, saveFromTooltip, segments, tooltipActions, VarInfo } from "./vars";
import { cellNeedsEditor } from "./cellMode";

const env = (vars: VarInfo[], name: string | null = "dev", id = "env-dev"): EnvDisplay => ({
  envId: name === null ? undefined : id,
  envName: name,
  vars: new Map(vars.map((v) => [v.key, v])),
});
const dev = env([
  { id: "v1", key: "BASE_URL", value: "https://x", secret: false, hasValue: true },
  { id: "v2", key: "TOKEN", value: "s3cret", secret: true, hasValue: true },
  { id: "v3", key: "UNSET", value: "", secret: true, hasValue: false },
]);

describe("tab context menu", () => {
  const keys = ["request:a", "env:b", "request:c"];
  it("Close / Close Others / Close All pick the right tabs", () => {
    expect(tabsToClose(keys, "env:b", "close")).toEqual(["env:b"]);
    expect(tabsToClose(keys, "env:b", "others")).toEqual(["request:a", "request:c"]);
    expect(tabsToClose(keys, "env:b", "all")).toEqual(keys);
    expect(tabsToClose(keys, "missing", "close")).toEqual([]);
  });
  it("closes each tab through the normal close path, one after another (each flushes)", async () => {
    const order: string[] = [];
    const flushed: string[] = [];
    const close = vi.fn(async (k: string) => {
      order.push(`close ${k}`);
      await Promise.resolve();
      flushed.push(k); // the real close awaits the tab's autosave flush
    });
    await closeEach(tabsToClose(keys, "env:b", "others"), close);
    expect(close).toHaveBeenCalledTimes(2);
    expect(flushed).toEqual(["request:a", "request:c"]);
    expect(order).toEqual(["close request:a", "close request:c"]);
  });
});

describe("Ctrl+Tab cycling", () => {
  const keys = ["a", "b", "c"];
  it("moves forward and backward in bar order, wrapping", () => {
    expect(cycleKey(keys, "a", 1)).toBe("b");
    expect(cycleKey(keys, "c", 1)).toBe("a");
    expect(cycleKey(keys, "a", -1)).toBe("c");
    expect(cycleKey(keys, "b", -1)).toBe("a");
  });
  it("handles no tabs, one tab, and no active tab", () => {
    expect(cycleKey([], undefined, 1)).toBeUndefined();
    expect(cycleKey(["x"], "x", 1)).toBe("x");
    expect(cycleKey(keys, undefined, 1)).toBe("a");
    expect(cycleKey(keys, undefined, -1)).toBe("c");
  });
  it("maps keys to actions", () => {
    const k = (o: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) =>
      shortcutAction({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
    expect(k({ key: "Tab", ctrlKey: true })).toBe("next");
    expect(k({ key: "Tab", ctrlKey: true, shiftKey: true })).toBe("prev");
    expect(k({ key: "w", ctrlKey: true })).toBe("close");
    expect(k({ key: "w", metaKey: true })).toBe("close");
    expect(k({ key: "Enter", ctrlKey: true })).toBe("send");
    expect(k({ key: "Tab" })).toBeUndefined();
    expect(k({ key: "w" })).toBeUndefined();
    expect(k({ key: "w", ctrlKey: true, altKey: true })).toBeUndefined();
    // Editor groups: Ctrl/Cmd+\ splits right, Ctrl/Cmd+1..9 focuses group N.
    expect(k({ key: "\\", ctrlKey: true })).toBe("split");
    expect(k({ key: "\\", metaKey: true })).toBe("split");
    expect(k({ key: "1", ctrlKey: true })).toBe("focus1");
    expect(k({ key: "9", metaKey: true })).toBe("focus9");
    expect(k({ key: "0", ctrlKey: true })).toBeUndefined(); // browser zoom reset, not ours
    expect(k({ key: "1" })).toBeUndefined();
    expect(k({ key: "1", ctrlKey: true, shiftKey: true })).toBeUndefined();
  });
  it("is a no-op with a modal open or without tabs", () => {
    expect(canUseTabShortcut({ modalOpen: false, tabCount: 2 })).toBe(true);
    expect(canUseTabShortcut({ modalOpen: true, tabCount: 2 })).toBe(false);
    expect(canUseTabShortcut({ modalOpen: false, tabCount: 0 })).toBe(false);
  });
});

describe("theme", () => {
  it("resolves the preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("applies the token set and follows OS changes only while on System", () => {
    let listener: (() => void) | undefined;
    const mql = { matches: true, addEventListener: (_: "change", fn: () => void) => (listener = fn), removeEventListener: vi.fn() };
    const root = { dataset: {} as Record<string, string | undefined> };
    const ctl = createThemeController(root, mql);
    expect(root.dataset.theme).toBe("dark"); // system + OS dark
    mql.matches = false;
    listener!();
    expect(root.dataset.theme).toBe("light"); // OS flipped live
    ctl.set("dark");
    mql.matches = false;
    listener!();
    expect(root.dataset.theme).toBe("dark"); // explicit choice ignores the OS
    ctl.set("system");
    expect(root.dataset.theme).toBe("light");
    ctl.dispose();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });
});

describe("tooltip editing", () => {
  const api = () => ({
    setValue: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ data: { id: "v9" } })),
    refresh: vi.fn(async () => undefined),
  });

  it("offers edit, edit-after-reveal, or create depending on the variable", () => {
    expect(tooltipActions("BASE_URL", dev)).toEqual({ edit: true, editAfterReveal: false });
    expect(tooltipActions("TOKEN", dev)).toEqual({ edit: false, editAfterReveal: true });
    expect(tooltipActions("UNSET", dev)).toEqual({ edit: true, editAfterReveal: false });
    expect(tooltipActions("NOPE", dev)).toEqual({ edit: false, editAfterReveal: false, createIn: "dev" });
    expect(tooltipActions("NOPE", env([], null))).toEqual({ edit: false, editAfterReveal: false });
  });

  it("saves through the normal variable path (Go keeps secrets local) and refreshes highlighting", async () => {
    const impl = api();
    expect(await saveFromTooltip("BASE_URL", "https://y", dev, impl)).toBeUndefined();
    expect(impl.setValue).toHaveBeenCalledWith("env-dev", "v1", "https://y");
    expect(await saveFromTooltip("TOKEN", "new-secret", dev, impl)).toBeUndefined();
    // Same bound call: SetVariableValue re-reads the type on the server and stores secrets locally only.
    expect(impl.setValue).toHaveBeenLastCalledWith("env-dev", "v2", "new-secret");
    expect(impl.create).not.toHaveBeenCalled();
    expect(impl.refresh).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed save and does not refresh", async () => {
    const impl = { ...api(), setValue: vi.fn(async () => ({ error: { message: "server unreachable" } })) };
    expect(await saveFromTooltip("BASE_URL", "x", dev, impl)).toBe("server unreachable");
    expect(impl.refresh).not.toHaveBeenCalled();
  });

  it("creates an unresolved key as a regular variable in the active env", async () => {
    const impl = api();
    expect(await createFromTooltip("NEW_KEY", dev, impl)).toEqual({ id: "v9" });
    expect(impl.create).toHaveBeenCalledWith("env-dev", "NEW_KEY", "regular");
    expect(await createFromTooltip("NEW_KEY", env([], null), impl)).toEqual({ error: "no environment selected" });
  });
});

describe("table cells", () => {
  it("render {{tokens}} as classified segments", () => {
    expect(segments("Bearer {{TOKEN}} {{NOPE}}!", dev)).toEqual([
      { text: "Bearer ", kind: "plain" },
      { text: "{{TOKEN}}", kind: "resolved" },
      { text: " ", kind: "plain" },
      { text: "{{NOPE}}", kind: "unresolved" },
      { text: "!", kind: "plain" },
    ]);
    expect(segments("", dev)).toEqual([]);
    expect(segments("plain", dev)).toEqual([{ text: "plain", kind: "plain" }]);
  });
  it("mount an editor only while focused, hovered, or editing in a tooltip", () => {
    expect(cellNeedsEditor({ focused: false, hovered: false, tooltipOpen: false })).toBe(false);
    expect(cellNeedsEditor({ focused: true, hovered: false, tooltipOpen: false })).toBe(true);
    expect(cellNeedsEditor({ focused: false, hovered: true, tooltipOpen: false })).toBe(true);
    expect(cellNeedsEditor({ focused: false, hovered: false, tooltipOpen: true })).toBe(true);
  });
});
