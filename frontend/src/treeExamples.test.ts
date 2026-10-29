import { beforeEach, describe, expect, it, vi } from "vitest";

// The bound Go methods the store calls (the save dialog's path ends in examplesChangedFor).
const listExamples = vi.fn();
vi.mock("../wailsjs/go/main/App", () => ({ ListExamples: (id: string) => listExamples(id) }));

import { createExampleCache } from "./exampleCache";
import { examplesChangedFor, exampleCount, exampleList, examplesTick, setExampleCounts } from "./examplesStore";
import { canSaveAsExample, ORPHAN_EXAMPLE_WHY } from "./historyModel";
import { buildTree, staleExpanded } from "./tree";
import { computeDrop, DndRow, placement } from "./treeDnd";
import { dragSourceOf } from "./treeDrag";
import { ExampleRows, navigate, shortcutApplies, visibleRows } from "./treeNav";

const ex = (id: string, status = 200) => ({ id, name: id, status });

describe("example cache: lazy, once, invalidated by change", () => {
  it("loads on the first ensure only — concurrent and later calls reuse it", async () => {
    const load = vi.fn(async () => [ex("e1"), ex("e2", 404)]);
    const c = createExampleCache(load);
    expect(c.list("r1")).toBeUndefined();
    await Promise.all([c.ensure("r1"), c.ensure("r1")]);
    await c.ensure("r1");
    expect(load).toHaveBeenCalledTimes(1);
    expect(c.list("r1")?.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(c.count("r1")).toBe(2);
    expect(c.ownerOf("e2")).toBe("r1");
  });

  it("a newer count that disagrees drops the list (a teammate added one); an equal count keeps it", async () => {
    const load = vi.fn(async () => [ex("e1")]);
    const c = createExampleCache(load);
    await c.ensure("r1");
    c.setCounts([["r1", 1], ["r2", 0]]);
    expect(c.list("r1")).toBeDefined();
    c.setCounts([["r1", 2]]);
    expect(c.list("r1")).toBeUndefined();
    expect(c.count("r1")).toBe(2);
    await c.ensure("r1"); // the expanded row loads again
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refresh re-fetches now (a save / rename / delete); invalidateAll drops lists and late answers", async () => {
    let names = ["a"];
    let release!: () => void;
    const load = vi.fn(async () => {
      if (names[0] === "slow") await new Promise<void>((r) => (release = r));
      return names.map((n) => ex(n));
    });
    const c = createExampleCache(load);
    await c.ensure("r1");
    names = ["a", "b"];
    await c.refresh("r1");
    expect(c.list("r1")?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(c.count("r1")).toBe(2);
    names = ["slow"];
    const late = c.ensure("r2");
    c.invalidateAll(); // ↻ while r2 loads
    expect(c.list("r1")).toBeUndefined();
    release();
    await late;
    expect(c.list("r2")).toBeUndefined(); // the answer from before the refresh is dropped
    expect(c.count("r1")).toBe(2); // counts stay: the chevron does not flicker
  });
});

describe("store: a save elsewhere refreshes the tree rows, the badge and open panels", () => {
  beforeEach(() => listExamples.mockReset());

  it("examplesChangedFor re-fetches that request's list and ticks", async () => {
    listExamples.mockResolvedValueOnce({ data: [ex("e1")] });
    setExampleCounts([["rq", 0]]);
    const tick = examplesTick();
    await examplesChangedFor("rq"); // SaveExampleDialog's onSaved, tree rename / delete
    expect(listExamples).toHaveBeenCalledWith("rq");
    expect(examplesTick()).toBe(tick + 1);
    expect(exampleCount("rq")).toBe(1);
    expect(exampleList("rq")?.map((e) => e.id)).toEqual(["e1"]);
    listExamples.mockResolvedValueOnce({ data: [] }); // deleted from the tree
    await examplesChangedFor("rq");
    expect(exampleCount("rq")).toBe(0);
  });
});

// Root: f (expanded: rA with 2 examples) · rB (no examples) · rC (1 example, not loaded yet)
const tree = buildTree(
  [{ id: "f", name: "f", sort_order: 0 }],
  [
    { id: "rA", folder_id: "f", name: "a", method: "GET", url: "", sort_order: 0, example_count: 2 },
    { id: "rB", name: "b", method: "GET", url: "", sort_order: 0 },
    { id: "rC", name: "c", method: "POST", url: "", sort_order: 1, example_count: 1 },
  ],
);
const counts: Record<string, number> = { rA: 2, rC: 1 };
const lists: Record<string, { id: string }[]> = { rA: [{ id: "eA1" }, { id: "eA2" }] };
const examples: ExampleRows = { count: (id) => counts[id] ?? 0, list: (id) => lists[id] };

describe("tree rows and keys with examples", () => {
  it("only a request with examples is expandable; loaded examples follow it as leaf rows", () => {
    const open = new Set(["f", "rA", "rB", "rC"]);
    const rows = visibleRows(tree.root, (id) => open.has(id), examples);
    expect(rows.map((r) => `${r.kind}:${r.id}${r.expanded ? "+" : ""}`)).toEqual([
      "folder:f+", "request:rA+", "example:eA1", "example:eA2", "request:rB", "request:rC+",
    ]);
    expect(rows.find((r) => r.id === "rB")).toMatchObject({ expandable: false, expanded: false }); // no chevron
    expect(rows.find((r) => r.id === "eA1")).toMatchObject({ parentId: "rA", expandable: false });
    // Without the examples source (old callers) requests are plain leaves.
    expect(visibleRows(tree.root, () => true).some((r) => r.kind === "example")).toBe(false);
  });

  it("Right expands a request with examples, then enters it; Left goes back; Enter opens an example", () => {
    const open = new Set(["f"]);
    const rows = () => visibleRows(tree.root, (id) => open.has(id), examples);
    expect(navigate(rows(), "rA", "ArrowRight")).toEqual({ type: "expand", id: "rA" });
    expect(navigate(rows(), "rB", "ArrowRight")).toBeNull(); // nothing to expand
    open.add("rA");
    expect(navigate(rows(), "rA", "ArrowRight")).toEqual({ type: "select", id: "eA1" });
    expect(navigate(rows(), "eA1", "ArrowRight")).toBeNull(); // a leaf
    expect(navigate(rows(), "eA1", "ArrowDown")).toEqual({ type: "select", id: "eA2" });
    expect(navigate(rows(), "eA2", "ArrowDown")).toEqual({ type: "select", id: "rB" });
    expect(navigate(rows(), "eA2", "ArrowLeft")).toEqual({ type: "select", id: "rA" });
    expect(navigate(rows(), "rA", "ArrowLeft")).toEqual({ type: "collapse", id: "rA" });
    expect(navigate(rows(), "eA1", "Enter")).toEqual({ type: "open", id: "eA1" });
    expect(navigate(rows(), "rA", "Enter")).toEqual({ type: "open", id: "rA" }); // a request opens, never toggles
    // Expanded but not loaded yet: Right has nowhere to go (the rows appear when loaded).
    open.add("rC");
    expect(navigate(rows(), "rC", "ArrowRight")).toBeNull();
    expect(shortcutApplies("duplicate", "example")).toBe(false);
    expect(shortcutApplies("rename", "example")).toBe(true);
    expect(shortcutApplies("delete", "example")).toBe(true);
  });

  it("expanded state persists for folders and requests with examples; the rest is stale", () => {
    expect(staleExpanded(["f", "rA", "rB", "gone", "rC"], tree)).toEqual(["rB", "gone"]);
  });
});

describe("drag and drop is unaffected by example rows", () => {
  // Rows as treeDrag reads them (li.tree-item only): rA's block spans its 2 example rows.
  const H = 28;
  const rows: DndRow[] = [
    { id: "f", kind: "folder", parentId: null, depth: 0, expanded: true, rowTop: 0, rowBottom: H, blockTop: 0, blockBottom: 4 * H },
    { id: "rA", kind: "request", parentId: "f", depth: 1, expanded: true, rowTop: H, rowBottom: 2 * H, blockTop: H, blockBottom: 4 * H },
    { id: "rB", kind: "request", parentId: null, depth: 0, expanded: false, rowTop: 4 * H, rowBottom: 5 * H, blockTop: 4 * H, blockBottom: 5 * H },
    { id: "rC", kind: "request", parentId: null, depth: 0, expanded: false, rowTop: 5 * H, rowBottom: 6 * H, blockTop: 5 * H, blockBottom: 6 * H },
  ];

  it("an example row is no drop target; after a request lands below its examples", () => {
    expect(computeDrop(rows, tree, { id: "rB", kind: "request" }, 2.5 * H)).toBeNull(); // over eA1
    expect(computeDrop(rows, tree, { id: "rB", kind: "request" }, 1.8 * H))
      .toMatchObject({ type: "insert", parentId: "f", index: 1, lineY: 4 * H });
    const d = computeDrop(rows, tree, { id: "rC", kind: "request" }, 4.2 * H)!;
    expect(placement(tree, { id: "rC", kind: "request" }, d)).toEqual({ currentParentId: "", targetParentId: "", orderedIds: ["rC", "rB"] });
  });

  it("only a press on a node's OWN row starts a drag — never an example row or a gap in its children", () => {
    // A pressed element: inside a .tree-row whose parent is `parent`, or no row at all.
    const li = (cls: string) => ({ matches: (sel: string) => sel === `li.${cls}` });
    const press = (parent: ReturnType<typeof li> | null, inside: string[] = []) => ({
      closest: (sel: string) => {
        if (sel === ".tree-row") return parent ? { parentElement: parent } : null;
        return sel.split(",").some((s) => inside.includes(s.trim())) ? { parentElement: null } : null;
      },
    });
    const request = li("tree-item");
    expect(dragSourceOf(press(request))).toBe(request); // the request's own row
    expect(dragSourceOf(press(li("tree-example")))).toBeNull(); // an example row inside it
    expect(dragSourceOf(press(null))).toBeNull(); // its children list's gap / "Loading examples…"
    expect(dragSourceOf(press(request, [".tree-examples-toggle"]))).toBeNull(); // the chevron
    expect(dragSourceOf(press(request, [".row-menu-trigger"]))).toBeNull();
  });
});

describe("save as example from history rows", () => {
  const ids = new Set(["r1"]);
  const row = { project_id: "p1", request_id: "r1", status: 200, error: "" };

  it("enabled for a response of an existing request (History tab rows, sub-tab rows, detail)", () => {
    expect(canSaveAsExample(row, "p1", ids)).toEqual({ ok: true, why: "" });
  });
  it("disabled with a reason: orphaned, no response, other project", () => {
    expect(canSaveAsExample({ ...row, request_id: "gone" }, "p1", ids)).toEqual({ ok: false, why: ORPHAN_EXAMPLE_WHY });
    expect(ORPHAN_EXAMPLE_WHY).toBe("original request no longer exists");
    expect(canSaveAsExample({ ...row, request_id: "" }, "p1", ids).why).toBe(ORPHAN_EXAMPLE_WHY);
    expect(canSaveAsExample({ ...row, status: 0, error: "dial tcp: refused" }, "p1", ids))
      .toEqual({ ok: false, why: "No response: the request failed" });
    expect(canSaveAsExample(row, "p2", ids).ok).toBe(false);
  });
});
