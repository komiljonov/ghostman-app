import { createMemo, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { followOptions, ownFollow, resolveFollow, saveFollow } from "./requestSettings";
import { Level, resolveSetting, sourceLabel } from "./settingsResolver";
import { buildTree, FolderInput, RequestInput } from "./tree";
import { currentTree, publishTree } from "./treeStore";

const lvl = (id: string, value: string, kind: "folder" | "request" = "folder"): Level => ({ id, kind, name: id.toUpperCase(), value });
const onOff = (v: string) => (v === "on" ? true : v === "off" ? false : undefined);
const resolve = (node: Level, ancestors: Level[], global = true) => resolveSetting(node, ancestors, global, onOff);

describe("resolveSetting (setting-agnostic)", () => {
  it("an explicit value on the node beats every ancestor", () => {
    expect(resolve(lvl("r", "on", "request"), [lvl("b", "off"), lvl("a", "off")], false))
      .toEqual({ value: true, source: { kind: "node", id: "r", nodeKind: "request", name: "R" } });
  });
  it("inherit walks up: the nearest folder with a value wins", () => {
    expect(resolve(lvl("r", "inherit", "request"), [lvl("b", "off"), lvl("a", "on")]))
      .toEqual({ value: false, source: { kind: "node", id: "b", nodeKind: "folder", name: "B" } });
    expect(resolve(lvl("r", "inherit", "request"), [lvl("b", "inherit"), lvl("a", "off")]).source)
      .toMatchObject({ id: "a" });
  });
  it("'global' stops the walk: the global value, even past an 'off' grandparent", () => {
    expect(resolve(lvl("r", "inherit", "request"), [lvl("b", "global"), lvl("a", "off")], true))
      .toEqual({ value: true, source: { kind: "global" } });
    expect(resolve(lvl("r", "global", "request"), [lvl("a", "off")], true)).toEqual({ value: true, source: { kind: "global" } });
  });
  it("all inherit: the global value, source global", () => {
    expect(resolve(lvl("r", "inherit", "request"), [lvl("b", "inherit"), lvl("a", "inherit")], false))
      .toEqual({ value: false, source: { kind: "global" } });
    expect(resolve(lvl("r", "inherit", "request"), [], true)).toEqual({ value: true, source: { kind: "global" } });
  });
  it("unknown values count as inherit (a newer server may add some)", () => {
    expect(resolve(lvl("r", "maybe", "request"), [lvl("a", "off")]).value).toBe(false);
  });
  it("is generic: any explicit value type", () => {
    const proxy = resolveSetting(lvl("r", "inherit", "request"), [lvl("a", "corp:3128")], "none",
      (v) => (v.includes(":") ? v : undefined));
    expect(proxy).toMatchObject({ value: "corp:3128", source: { id: "a" } });
    expect(sourceLabel(proxy.source)).toBe("from folder ‘A’");
    expect(sourceLabel({ kind: "global" })).toBe("global");
  });
});

// Folder A('off') contains B, which holds request R and another request S; T sits at the root.
const folders = (a = "off", b = "inherit"): FolderInput[] => [
  { id: "A", parent_id: null, name: "A", sort_order: 0, follow_redirects: a },
  { id: "B", parent_id: "A", name: "B", sort_order: 0, follow_redirects: b },
];
const reqs = (r = "inherit", rFolder: string | null = "B"): RequestInput[] => [
  { id: "R", folder_id: rFolder, name: "R", method: "GET", url: "", sort_order: 0, follow_redirects: r },
  { id: "S", folder_id: "B", name: "S", method: "GET", url: "", sort_order: 1 }, // absent = inherit
  { id: "T", folder_id: null, name: "T", method: "GET", url: "", sort_order: 2, follow_redirects: "inherit" },
];
const fromA = "(from folder ‘A’)";
const fromB = "(from folder ‘B’)";

describe("follow_redirects over the tree store (the verify scenarios)", () => {
  it("1: A off > B inherit > R inherit gives off, from folder A", () => {
    const t = buildTree(folders(), reqs());
    expect(resolveFollow(t, "R", true)).toEqual({ value: false, source: { kind: "node", id: "A", nodeKind: "folder", name: "A" } });
    expect(followOptions(t, "R", true).map((o) => o.label)).toEqual([
      `Inherit from parent — currently: off ${fromA}`,
      "Use global setting — currently: on",
      "Always follow",
      "Never follow",
    ]);
    expect(ownFollow(t, "R")).toBe("inherit");
  });
  it("2: R on 'Use global' follows despite A", () => {
    const t = buildTree(folders(), reqs("global"));
    expect(resolveFollow(t, "R", true)).toEqual({ value: true, source: { kind: "global" } });
    expect(ownFollow(t, "R")).toBe("global");
  });
  it("3: B 'on': S (inherit) follows from B; R stays pinned to global", () => {
    const t = buildTree(folders("off", "on"), reqs("global"));
    expect(resolveFollow(t, "S", false)).toMatchObject({ value: true, source: { id: "B" } });
    expect(resolveFollow(t, "R", false)).toEqual({ value: false, source: { kind: "global" } });
    expect(followOptions(t, "S", false)[0].label).toBe(`Inherit from parent — currently: on ${fromB}`);
  });
  it("4: moving R to the root changes the source to global", () => {
    expect(resolveFollow(buildTree(folders(), reqs("inherit", "B")), "R", true).source).toMatchObject({ id: "A" });
    const moved = buildTree(folders(), reqs("inherit", null));
    expect(resolveFollow(moved, "R", true)).toEqual({ value: true, source: { kind: "global" } });
    expect(followOptions(moved, "R", true)[0].label).toBe("Inherit from parent — currently: on (global)");
  });
  it("a folder's own 'inherit' label names ITS parent chain", () => {
    const t = buildTree(folders("off", "on"), reqs());
    expect(followOptions(t, "B", true)[0].label).toBe(`Inherit from parent — currently: off ${fromA}`);
    expect(followOptions(t, "A", false)[0].label).toBe("Inherit from parent — currently: off (global)");
  });
  it("unknown ids fall back to the global value", () => {
    expect(resolveFollow(buildTree([], []), "nope", false)).toEqual({ value: false, source: { kind: "global" } });
  });
});

describe("saving and re-resolving", () => {
  it("saves on the server, then re-fetches (never patches locally)", async () => {
    const calls: string[] = [];
    const problem = await saveFollow("R", "off", {
      set: async (id, v) => (calls.push(`set ${id} ${v}`), {}),
      reload: async () => void calls.push("reload"),
    });
    expect(problem).toBeUndefined();
    expect(calls).toEqual(["set R off", "reload"]);
  });
  it("a failed save surfaces the problem and does not re-fetch", async () => {
    const reload = vi.fn();
    const err = { kind: "server", status: 403, code: "forbidden", message: "no access" };
    expect(await saveFollow("R", "on", { set: async () => ({ error: err }), reload })).toBe(err);
    expect(reload).not.toHaveBeenCalled();
  });
  it("open tabs re-resolve when the tree store changes (folder change, move) or the global value flips", () => {
    createRoot((dispose) => {
      const [global, setGlobal] = createSignal(true);
      const label = createMemo(() => followOptions(currentTree(), "R", global())[0].label);
      const effective = createMemo(() => resolveFollow(currentTree(), "R", global()).value);

      publishTree(buildTree(folders(), reqs()));
      expect(label()).toBe(`Inherit from parent — currently: off ${fromA}`);
      expect(effective()).toBe(false);

      publishTree(buildTree(folders("on"), reqs())); // folder setting changed: tree re-fetched
      expect(label()).toBe(`Inherit from parent — currently: on ${fromA}`);

      publishTree(buildTree(folders(), reqs("inherit", null))); // R moved to the root
      expect(label()).toBe("Inherit from parent — currently: on (global)");
      setGlobal(false); // global toggle
      expect(label()).toBe("Inherit from parent — currently: off (global)");
      expect(effective()).toBe(false);
      dispose();
    });
  });
});
