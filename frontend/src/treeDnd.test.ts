import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";
import { computeDrop, DndRow, Dragged, isInSubtree, placement } from "./treeDnd";

// Root: fA (expanded: fA1 collapsed, rA1, rA2) · fB (collapsed: rB1) · r1 · r2
const tree = buildTree(
  [
    { id: "fA", parent_id: null, name: "A", sort_order: 0 },
    { id: "fA1", parent_id: "fA", name: "A1", sort_order: 0 },
    { id: "fB", parent_id: null, name: "B", sort_order: 1 },
  ],
  [
    { id: "rA1", folder_id: "fA", name: "a1", method: "GET", url: "", sort_order: 0 },
    { id: "rA2", folder_id: "fA", name: "a2", method: "GET", url: "", sort_order: 1 },
    { id: "rB1", folder_id: "fB", name: "b1", method: "GET", url: "", sort_order: 0 },
    { id: "r1", folder_id: null, name: "r1", method: "GET", url: "", sort_order: 0 },
    { id: "r2", folder_id: null, name: "r2", method: "GET", url: "", sort_order: 1 },
  ],
);

// Visible rows, 28 px each; fA's block spans its children.
const H = 28;
const layout: [string, DndRow["kind"], string | null, number, boolean, number][] = [
  ["fA", "folder", null, 0, true, 4],
  ["fA1", "folder", "fA", 1, false, 1],
  ["rA1", "request", "fA", 1, false, 1],
  ["rA2", "request", "fA", 1, false, 1],
  ["fB", "folder", null, 0, false, 1],
  ["r1", "request", null, 0, false, 1],
  ["r2", "request", null, 0, false, 1],
];
const rows: DndRow[] = layout.map(([id, kind, parentId, depth, expanded, span], i) => ({
  id, kind, parentId, depth, expanded,
  rowTop: i * H, rowBottom: (i + 1) * H, blockTop: i * H, blockBottom: (i + span) * H,
}));
const at = (id: string, frac: number) => {
  const r = rows.find((x) => x.id === id)!;
  return r.rowTop + frac * H;
};
const req = (id: string): Dragged => ({ id, kind: "request" });
const folder = (id: string): Dragged => ({ id, kind: "folder" });

describe("drop targets", () => {
  it("middle of a folder row → into it; edges of a collapsed folder → before/after", () => {
    expect(computeDrop(rows, tree, req("r1"), at("fB", 0.5))).toEqual({ type: "into", folderId: "fB" });
    expect(computeDrop(rows, tree, req("r1"), at("fB", 0.1))?.type).toBe("insert");
    expect(computeDrop(rows, tree, folder("fA1"), at("fB", 0.9))).toMatchObject({ type: "insert", parentId: null });
    // An expanded folder has no "after" zone: its lower part is "into".
    expect(computeDrop(rows, tree, req("r1"), at("fA", 0.9))).toEqual({ type: "into", folderId: "fA" });
  });
  it("request rows split in halves: before / after", () => {
    expect(computeDrop(rows, tree, req("r1"), at("r2", 0.2))).toMatchObject({ type: "insert", parentId: null, index: 0 });
    expect(computeDrop(rows, tree, req("r1"), at("r2", 0.8))).toMatchObject({ type: "insert", parentId: null, index: 1, lineY: 7 * H });
  });
  it("below the last row → the end of the root", () => {
    expect(computeDrop(rows, tree, req("rA1"), 500)).toMatchObject({ type: "insert", parentId: null, index: 2, depth: 0 });
  });
  it("over the dragged row itself: no target", () => {
    expect(computeDrop(rows, tree, req("r1"), at("r1", 0.5))).toBeNull();
  });
});

describe("folders never drop into themselves or their subtree", () => {
  it("isInSubtree follows the parent chain", () => {
    expect(isInSubtree(tree, "fA", folder("fA"))).toBe(true);
    expect(isInSubtree(tree, "fA", folder("fA1"))).toBe(true);
    expect(isInSubtree(tree, "fA", req("rA2"))).toBe(true);
    expect(isInSubtree(tree, "fA", req("rB1"))).toBe(false);
    expect(isInSubtree(tree, "fA1", folder("fA"))).toBe(false);
  });
  it("no target anywhere inside the dragged folder (no indicator, no-drop cursor)", () => {
    for (const [id, frac] of [["fA", 0.5], ["fA1", 0.5], ["fA1", 0.1], ["rA1", 0.2], ["rA2", 0.9]] as const) {
      expect(computeDrop(rows, tree, folder("fA"), at(id, frac))).toBeNull();
    }
    // …but the same rows are fine targets for something else.
    expect(computeDrop(rows, tree, folder("fB"), at("fA1", 0.5))).toEqual({ type: "into", folderId: "fA1" });
  });
});

describe("insert index math (folders and requests ordered separately)", () => {
  it("a request dropped next to a folder goes to the start of the requests", () => {
    const d = computeDrop(rows, tree, req("r2"), at("fB", 0.1));
    expect(d).toMatchObject({ type: "insert", parentId: null, index: 0, lineY: rows[5].blockTop });
  });
  it("a folder dropped next to a request goes to the end of the folders", () => {
    const d = computeDrop(rows, tree, folder("fA1"), at("r1", 0.2));
    expect(d).toMatchObject({ type: "insert", parentId: null, index: 2, lineY: rows[4].blockBottom });
  });
  it("before a folder among folders", () => {
    expect(computeDrop(rows, tree, folder("fB"), at("fA", 0.1))).toMatchObject({ index: 0, lineY: 0, parentId: null });
  });
});

describe("what a drop sends (PlaceNode arguments)", () => {
  it("into another folder: move only, appended", () => {
    expect(placement(tree, req("r1"), { type: "into", folderId: "fB" }))
      .toEqual({ currentParentId: "", targetParentId: "fB", orderedIds: null });
  });
  it("reorder within the parent: the full new sibling order", () => {
    const d = computeDrop(rows, tree, req("r1"), at("r2", 0.8))!;
    expect(placement(tree, req("r1"), d)).toEqual({ currentParentId: "", targetParentId: "", orderedIds: ["r2", "r1"] });
  });
  it("to another parent at a position: move + that parent's new order", () => {
    const d = computeDrop(rows, tree, req("rA2"), at("r1", 0.2))!;
    expect(placement(tree, req("rA2"), d)).toEqual({ currentParentId: "fA", targetParentId: "", orderedIds: ["rA2", "r1", "r2"] });
    const f = computeDrop(rows, tree, folder("fA1"), at("fB", 0.9))!;
    expect(placement(tree, folder("fA1"), f)).toEqual({ currentParentId: "fA", targetParentId: "", orderedIds: ["fA", "fB", "fA1"] });
  });
  it("into its own folder moves it to the end; already last is a no-op", () => {
    expect(placement(tree, req("rA1"), { type: "into", folderId: "fA" }))
      .toEqual({ currentParentId: "fA", targetParentId: "fA", orderedIds: ["rA2", "rA1"] });
    expect(placement(tree, req("rA2"), { type: "into", folderId: "fA" })).toBeNull();
  });
  it("a drop that changes nothing sends nothing", () => {
    const d = computeDrop(rows, tree, req("r1"), at("r2", 0.2))!; // before r2 = where r1 already is
    expect(placement(tree, req("r1"), d)).toBeNull();
    const same = computeDrop(rows, tree, req("r2"), at("fB", 0.1))!; // r2 → start of requests: r2 before r1
    expect(placement(tree, req("r2"), same)).toEqual({ currentParentId: "", targetParentId: "", orderedIds: ["r2", "r1"] });
  });
});
