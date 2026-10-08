import { describe, expect, it } from "vitest";
import {
  activateTab, allGroups, allTabs, closeTab, enforceMinimums, entrySide, findGroup, focusGroup, group, Layout, LayoutNode,
  layoutRects, minFractions, moveTab, normalize, openTab, parseLayout, pruneTabs, removeGroup, resetSizes, resize,
  serializeLayout, singleGroup, splitGroup, SplitNode,
} from "./layoutTree";

// A compact picture of a tree: groups as [tabs*active], splits as H(...) / V(...).
function show(n: LayoutNode): string {
  if (n.type === "group") return `[${n.tabs.map((t) => (t === n.activeTabId ? `${t}*` : t)).join(" ")}]`;
  return `${n.direction === "horizontal" ? "H" : "V"}(${n.children.map(show).join(" ")})`;
}
const sizes = (n: LayoutNode) => (n.type === "split" ? n.sizes.map((s) => Math.round(s * 1000) / 1000) : []);
const ids = (l: Layout) => allGroups(l.root).map((g) => g.id);

const start = (): Layout => ({ root: group("A", ["a", "b", "c"], "b"), focusedGroupId: "A" });

describe("split", () => {
  it("right / left / down / up of a lone group: a new split, 50/50, focus on the new group", () => {
    for (const [side, picture, dir] of [
      // b leaves A: the tab now in its place (c) becomes A's active one, as when closing.
      ["right", "H([a c*] [b*])", "horizontal"], ["left", "H([b*] [a c*])", "horizontal"],
      ["bottom", "V([a c*] [b*])", "vertical"], ["top", "V([b*] [a c*])", "vertical"],
    ] as const) {
      const l = splitGroup(start(), "A", side, "b", "B");
      expect(show(l.root)).toBe(picture);
      expect((l.root as SplitNode).direction).toBe(dir);
      expect(sizes(l.root)).toEqual([0.5, 0.5]);
      expect(l.focusedGroupId).toBe("B");
    }
  });

  it("flattens: splitting right inside a horizontal split adds a sibling sharing the target's space", () => {
    let l = splitGroup(start(), "A", "right", "c", "B"); // H(A B) 50/50
    l = splitGroup(l, "B", "right", "a", "C"); // B's half shared: 0.5, 0.25, 0.25
    expect(show(l.root)).toBe("H([b*] [c*] [a*])");
    expect(sizes(l.root)).toEqual([0.5, 0.25, 0.25]);
    l = splitGroup(l, "A", "left", "c", "D"); // left of A: A's half shared
    expect(show(l.root)).toBe("H([c*] [b*] [a*])"); // B emptied (c moved) and collapsed
    expect(allGroups(l.root).length).toBe(3);
  });

  it("a cross-direction split nests", () => {
    let l = splitGroup(start(), "A", "right", "c", "B");
    l = splitGroup(l, "B", "bottom", "a", "C");
    expect(show(l.root)).toBe("H([b*] V([c*] [a*]))");
    expect(sizes((l.root as SplitNode).children[1])).toEqual([0.5, 0.5]);
  });

  it("the only tab split off its own group: the very same layout (VS Code closes the vacated group), not resized", () => {
    let l = splitGroup(start(), "A", "right", "c", "B"); // H([a b*] [c*])
    l = splitGroup(l, "B", "right", "a", "C"); // three side by side: 0.5 / 0.25 / 0.25
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const again = splitGroup(l, "C", side, "a", "N");
      expect(show(again.root)).toBe(show(l.root));
      expect(sizes(again.root)).toEqual(sizes(l.root));
      expect(ids(again)).toEqual(ids(l));
      expect(again.focusedGroupId).toBe("C");
    }
  });
});

describe("move / close / collapse", () => {
  const twoGroups = () => splitGroup(start(), "A", "right", "c", "B"); // H([a b*] [c*])

  it("move to another group at an index, activates it there", () => {
    const l = moveTab(twoGroups(), "a", "B", 0);
    expect(show(l.root)).toBe("H([b*] [a* c])");
    expect(l.focusedGroupId).toBe("B");
  });

  it("moving a group's last tab out removes the group and collapses the split", () => {
    const l = moveTab(twoGroups(), "c", "A", 1);
    expect(show(l.root)).toBe("[a c* b]");
    expect(l.focusedGroupId).toBe("A");
  });

  it("collapse redistributes sizes proportionally", () => {
    let l = splitGroup(start(), "A", "right", "c", "B");
    l = splitGroup(l, "B", "right", "a", "C"); // 0.5 / 0.25 / 0.25
    l = closeTab(l, "c"); // B (0.25) goes: A 0.5→2/3, C 0.25→1/3
    expect(show(l.root)).toBe("H([b*] [a*])");
    expect(sizes(l.root)).toEqual([0.667, 0.333]);
  });

  it("reorder within a group (insertion slots between original positions)", () => {
    expect(show(moveTab(start(), "a", "A", 3).root)).toBe("[b c a*]");
    expect(show(moveTab(start(), "c", "A", 0).root)).toBe("[c* a b]");
    expect(show(moveTab(start(), "b", "A", 2).root)).toBe("[a b* c]"); // onto itself
  });

  it("close: neighbor becomes active; the last tab of the last group leaves the empty state", () => {
    expect(show(closeTab(start(), "b").root)).toBe("[a c*]");
    expect(show(closeTab(start(), "c").root)).toBe("[a b*]");
    let l = singleGroup(["x"], "x", "G");
    l = closeTab(l, "x");
    expect(show(l.root)).toBe("[]");
    expect(l.focusedGroupId).toBe("G");
  });

  it("closing a focused group's last tab focuses its neighbor", () => {
    const l = closeTab(twoGroups(), "c");
    expect(l.focusedGroupId).toBe("A");
  });

  it("removeGroup drops the group and its tabs", () => {
    const l = removeGroup(twoGroups(), "A");
    expect(show(l.root)).toBe("[c*]");
    expect(l.focusedGroupId).toBe("B");
  });

  it("open: reveals an open tab where it is; a new one goes after the focused group's active tab", () => {
    let l = twoGroups();
    l = openTab(l, "c"); // already in B
    expect(l.focusedGroupId).toBe("B");
    l = focusGroup(l, "A");
    l = openTab(l, "z");
    expect(show(l.root)).toBe("H([a b z*] [c*])");
    expect(activateTab(l, "a").focusedGroupId).toBe("A");
  });
});

describe("resize", () => {
  it("moves the boundary, clamped to the neighbors' minimums", () => {
    const l = splitGroup(start(), "A", "right", "c", "B");
    const s = (l.root as SplitNode).id;
    const mins = minFractions(l.root as SplitNode, 1000); // 200px of 1000 → 0.2 each
    expect(mins).toEqual([0.2, 0.2]);
    expect(sizes(resize(l, s, 0, 0.1, mins).root)).toEqual([0.6, 0.4]);
    expect(sizes(resize(l, s, 0, 0.9, mins).root)).toEqual([0.8, 0.2]); // clamped
    expect(sizes(resize(l, s, 0, -0.9, mins).root)).toEqual([0.2, 0.8]);
    expect(sizes(resetSizes(resize(l, s, 0, 0.2, mins), s).root)).toEqual([0.5, 0.5]);
  });

  it("nested minimums add up along the split", () => {
    let l = splitGroup(start(), "A", "right", "c", "B");
    l = splitGroup(l, "B", "right", "a", "C"); // H(A B C)
    l = splitGroup(l, "A", "bottom", "b", "D"); // H(V(? ...)) — A had only b left: moves aside
    const root = l.root as SplitNode;
    expect(minFractions(root, 1000)).toEqual([0.2, 0.2, 0.2]);
  });

  it("enforceMinimums lifts too-small children, taking the room from the others", () => {
    const l: Layout = {
      root: { type: "split", id: "S", direction: "horizontal", children: [group("A", ["a"]), group("B", ["b"])], sizes: [0.05, 0.95] },
      focusedGroupId: "A",
    };
    expect(sizes(enforceMinimums(l, 1000, 600).root)).toEqual([0.2, 0.8]);
    expect(sizes(enforceMinimums(l, 300, 600).root)).toEqual([0.5, 0.5]); // too small for both: equal
    // Exactly at the minimum: unchanged (no drift on every restore).
    const atMin: Layout = { ...l, root: { ...(l.root as SplitNode), sizes: [200 / 510, 310 / 510] } };
    expect(enforceMinimums(atMin, 510, 600)).toEqual(atMin);
  });
});

describe("geometry", () => {
  it("a new group grows in from its side of the split", () => {
    let l = splitGroup(start(), "A", "right", "c", "B");
    expect(entrySide(l.root, "B")).toBe("right");
    expect(entrySide(l.root, "A")).toBe("left");
    l = splitGroup(l, "B", "top", "a", "C");
    expect(entrySide(l.root, "C")).toBe("top");
    expect(entrySide(singleGroup(["x"], "x", "G").root, "G")).toBeNull();
  });

  it("rects and sashes in fractions", () => {
    let l = splitGroup(start(), "A", "right", "c", "B");
    l = splitGroup(l, "B", "bottom", "a", "C");
    const { groups, sashes } = layoutRects(l.root);
    expect(groups).toEqual([
      { id: "A", x: 0, y: 0, w: 0.5, h: 1 },
      { id: "B", x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { id: "C", x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ]);
    expect(sashes.map((s) => [s.direction, s.x, s.y, s.w, s.h])).toEqual([
      ["horizontal", 0.5, 0, 0, 1], ["vertical", 0.5, 0.5, 0.5, 0],
    ]);
  });
});

describe("persistence", () => {
  const isTabKey = (k: string) => /^(request|env):.+$|^(env_list|history):$/.test(k);

  it("round trip", () => {
    let l = splitGroup(start(), "A", "right", "c", "B");
    l = splitGroup(l, "B", "bottom", "a", "C");
    const raw = JSON.parse(JSON.stringify(serializeLayout(l)));
    expect(raw.version).toBe(1);
    const back = parseLayout(raw, () => true)!;
    expect(show(back.root)).toBe(show(l.root));
    expect(back.focusedGroupId).toBe(l.focusedGroupId);
    expect(sizes(back.root)).toEqual(sizes(l.root));
  });

  it("restore with missing requests: their tabs go, empty groups and splits collapse", () => {
    const l: Layout = {
      root: {
        type: "split", id: "S", direction: "horizontal", sizes: [0.3, 0.7],
        children: [group("A", ["request:gone"]), group("B", ["request:1", "request:gone2"], "request:gone2")],
      },
      focusedGroupId: "A",
    };
    const back = pruneTabs(parseLayout(serializeLayout(l), isTabKey)!, (k) => !k.includes("gone"));
    expect(show(back.root)).toBe("[request:1*]");
    expect(back.focusedGroupId).toBe("B");
  });

  it("corrupt or foreign data → null (the caller falls back to one empty group)", () => {
    for (const raw of [null, "x", 42, {}, { version: 2, layout: {} }, { version: 1 }, { version: 1, layout: { root: { type: "pane" } } }]) {
      expect(parseLayout(raw, isTabKey)).toBeNull();
    }
  });

  it("repairs: unknown tab keys, duplicates across groups, bad sizes, duplicate ids, nested same-direction splits", () => {
    const raw = {
      version: 1,
      layout: {
        focusedGroupId: "nope",
        root: {
          type: "split", id: "S", direction: "horizontal", sizes: [-1, "x"],
          children: [
            { type: "group", id: "A", tabs: ["request:1", "bogus", "request:1"], activeTabId: "bogus" },
            {
              type: "split", id: "S2", direction: "horizontal", sizes: [1, 1],
              children: [{ type: "group", id: "A", tabs: ["request:1", "env:e"] }, { type: "group", id: "C", tabs: [] }],
            },
          ],
        },
      },
    };
    const l = parseLayout(raw, isTabKey)!;
    expect(show(l.root)).toBe("H([request:1*] [env:e*])"); // dup tab dropped, empty group gone, flattened
    expect(sizes(l.root)).toEqual([0.5, 0.5]);
    expect(new Set(ids(l)).size).toBe(2); // the duplicate id was replaced
    expect(ids(l)).toContain(l.focusedGroupId);
  });

  it("normalize keeps every invariant on a messy tree", () => {
    const messy: Layout = {
      root: {
        type: "split", id: "S", direction: "vertical", sizes: [1, 1, 1],
        children: [
          group("A", []), // empty
          { type: "split", id: "S2", direction: "vertical", sizes: [1, 3], children: [group("B", ["b"]), group("C", ["c"])] },
          { type: "split", id: "S3", direction: "horizontal", sizes: [1], children: [group("D", ["d"])] },
        ],
      },
      focusedGroupId: "A",
    };
    const l = normalize(messy);
    expect(show(l.root)).toBe("V([b*] [c*] [d*])");
    expect(sizes(l.root)).toEqual([0.125, 0.375, 0.5]);
    expect(l.focusedGroupId).toBe("B");
    expect(allTabs(l.root)).toEqual(["b", "c", "d"]);
    expect(findGroup(l.root, "A")).toBeUndefined();
  });
});
