import { describe, expect, it, vi } from "vitest";
import { buildTree, flattenFolders, folderAndDescendantIds, reorderedSiblingIds, TreeNode } from "./tree";

const f = (id: string, parent_id: string | null, sort_order = 0, name = id) => ({ id, parent_id, name, sort_order });
const r = (id: string, folder_id: string | null, sort_order = 0, method = "GET") =>
  ({ id, folder_id, name: id, method, url: "", sort_order });

// Compact shape for assertions: "A[B[R2],R3]" etc.
const shape = (nodes: TreeNode[]): string =>
  nodes.map((n) => (n.kind === "folder" ? `${n.id}[${shape(n.children)}]` : n.id)).join(",");

describe("buildTree", () => {
  it("nests folders and requests by parent id", () => {
    const tree = buildTree([f("A", null), f("B", "A")], [r("R1", null), r("R2", "B")]);
    expect(shape(tree.root)).toBe("A[B[R2]],R1");
    expect(tree.requestCount).toBe(2);
    expect(tree.folders.get("B")?.parentId).toBe("A");
  });

  it("treats undefined parent ids (Wails optional fields) as root", () => {
    const tree = buildTree([{ id: "A", name: "A", sort_order: 0 }], [{ id: "R", name: "R", method: "GET", url: "", sort_order: 0 }]);
    expect(shape(tree.root)).toBe("A[],R");
  });

  it("orders siblings by sort_order, folders before requests", () => {
    const tree = buildTree(
      [f("F2", null, 1), f("F1", null, 0), f("C2", "F1", 5), f("C1", "F1", 2)],
      [r("R2", null, 0), r("R1", null, 1), r("X", "F1", 0)],
    );
    expect(shape(tree.root)).toBe("F1[C1[],C2[],X],F2[],R2,R1");
  });

  it("drops orphans to the root with a warning", () => {
    const warn = vi.fn();
    const tree = buildTree([f("A", "gone")], [r("R", "missing")], warn);
    expect(shape(tree.root)).toBe("A[],R");
    expect(tree.folders.get("A")?.parentId).toBeNull();
    expect(tree.requests.get("R")?.folderId).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("breaks parent cycles instead of losing folders", () => {
    const warn = vi.fn();
    const tree = buildTree([f("A", "B"), f("B", "A")], [], warn);
    expect(tree.folders.size).toBe(2);
    expect(flattenFolders(tree).map((x) => x.folder.id).sort()).toEqual(["A", "B"]);
    expect(warn).toHaveBeenCalled();
  });

  it("handles empty input", () => {
    const tree = buildTree([], []);
    expect(tree.root).toEqual([]);
    expect(tree.requestCount).toBe(0);
  });
});

describe("tree helpers", () => {
  const tree = buildTree(
    [f("A", null, 0), f("B", "A", 0), f("C", "B", 0), f("D", null, 1)],
    [r("R1", "B", 0), r("R2", "B", 1), r("R3", null, 0)],
  );

  it("computes the full sibling list for move up/down (same kind only)", () => {
    expect(reorderedSiblingIds(tree, tree.requests.get("R2")!, -1)).toEqual(["R2", "R1"]);
    expect(reorderedSiblingIds(tree, tree.requests.get("R1")!, -1)).toBeNull();
    expect(reorderedSiblingIds(tree, tree.folders.get("A")!, 1)).toEqual(["D", "A"]);
    // R3 is the only root request: folders at root are not its siblings.
    expect(reorderedSiblingIds(tree, tree.requests.get("R3")!, -1)).toBeNull();
  });

  it("lists a folder with its descendants (invalid move targets)", () => {
    expect([...folderAndDescendantIds(tree.folders.get("A")!)].sort()).toEqual(["A", "B", "C"]);
    expect([...folderAndDescendantIds(tree.folders.get("D")!)]).toEqual(["D"]);
  });

  it("flattens folders in display order with depth", () => {
    expect(flattenFolders(tree).map((x) => `${x.folder.id}:${x.depth}`)).toEqual(["A:0", "B:1", "C:2", "D:0"]);
  });
});
