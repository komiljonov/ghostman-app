import { describe, expect, it } from "vitest";
import { applyDrop, GroupHit, hitTest, insertionX, isNoop, overlayRect, zoneAt } from "./dropZone";
import { allGroups, group, Layout, LayoutNode, splitGroup } from "./layoutTree";

const box = { left: 0, top: 0, width: 300, height: 300 };

describe("zones", () => {
  it("outer third of each side is an edge, the middle is the center", () => {
    expect(zoneAt(box, 150, 150)).toBe("center");
    expect(zoneAt(box, 20, 150)).toBe("left");
    expect(zoneAt(box, 280, 150)).toBe("right");
    expect(zoneAt(box, 150, 20)).toBe("top");
    expect(zoneAt(box, 150, 290)).toBe("bottom");
    expect(zoneAt(box, 98, 150)).toBe("left"); // just inside 33%
    expect(zoneAt(box, 101, 150)).toBe("center");
  });
  it("in a corner the nearer edge wins", () => {
    expect(zoneAt(box, 10, 40)).toBe("left");
    expect(zoneAt(box, 40, 10)).toBe("top");
  });
  it("preview rects: whole group for the center, the half on that side for an edge", () => {
    expect(overlayRect(box, "center")).toEqual(box);
    expect(overlayRect(box, "left")).toEqual({ left: 0, top: 0, width: 150, height: 300 });
    expect(overlayRect(box, "right")).toEqual({ left: 150, top: 0, width: 150, height: 300 });
    expect(overlayRect(box, "top")).toEqual({ left: 0, top: 0, width: 300, height: 150 });
    expect(overlayRect(box, "bottom")).toEqual({ left: 0, top: 150, width: 300, height: 150 });
  });
});

describe("hit test", () => {
  const groups: GroupHit[] = [
    {
      id: "A", bar: { left: 0, top: 0, width: 400, height: 30 }, content: { left: 0, top: 30, width: 400, height: 370 },
      tabs: [{ left: 0, top: 0, width: 100, height: 30 }, { left: 100, top: 0, width: 100, height: 30 }],
    },
    { id: "B", bar: { left: 400, top: 0, width: 400, height: 30 }, content: { left: 400, top: 30, width: 400, height: 370 }, tabs: [] },
  ];
  it("tab bar → insertion index; content → zone; elsewhere → nothing", () => {
    expect(hitTest(groups, 40, 10)).toEqual({ kind: "bar", groupId: "A", index: 0 });
    expect(hitTest(groups, 160, 10)).toEqual({ kind: "bar", groupId: "A", index: 2 });
    expect(hitTest(groups, 700, 10)).toEqual({ kind: "bar", groupId: "B", index: 0 });
    expect(hitTest(groups, 600, 200)).toEqual({ kind: "zone", groupId: "B", zone: "center" });
    expect(hitTest(groups, 790, 200)).toEqual({ kind: "zone", groupId: "B", zone: "right" });
    expect(hitTest(groups, 900, 200)).toBeNull();
  });
  it("insertion line position", () => {
    expect(insertionX(groups[0], 1)).toBe(100);
    expect(insertionX(groups[0], 2)).toBe(200);
    expect(insertionX(groups[1], 0)).toBe(404);
  });
});

function show(n: LayoutNode): string {
  if (n.type === "group") return `[${n.tabs.map((t) => (t === n.activeTabId ? `${t}*` : t)).join(" ")}]`;
  return `${n.direction === "horizontal" ? "H" : "V"}(${n.children.map(show).join(" ")})`;
}

describe("drops", () => {
  const one = (): Layout => ({ root: group("A", ["a", "b"], "a"), focusedGroupId: "A" });
  const two = () => splitGroup(one(), "A", "right", "b", "B"); // H([a*] [b*])

  it("edge of another group splits it; center appends; tab bar inserts", () => {
    expect(show(applyDrop(one(), "b", { kind: "zone", groupId: "A", zone: "bottom" }, "N")!.root)).toBe("V([a*] [b*])");
    expect(show(applyDrop(two(), "a", { kind: "zone", groupId: "B", zone: "center" })!.root)).toBe("[b a*]");
    expect(show(applyDrop(two(), "a", { kind: "bar", groupId: "B", index: 0 })!.root)).toBe("[a* b]");
  });
  it("no-ops: own center, onto itself in its own bar", () => {
    expect(applyDrop(two(), "a", { kind: "zone", groupId: "A", zone: "center" })).toBeNull();
    expect(isNoop(one(), "a", { kind: "bar", groupId: "A", index: 0 })).toBe(true);
    expect(isNoop(one(), "a", { kind: "bar", groupId: "A", index: 1 })).toBe(true);
    expect(isNoop(one(), "a", { kind: "bar", groupId: "A", index: 2 })).toBe(false);
  });
  it("the only tab on its own group's edge: the same layout, so a no-op (no preview)", () => {
    for (const zone of ["left", "right", "top", "bottom"] as const) {
      expect(isNoop(two(), "b", { kind: "zone", groupId: "B", zone })).toBe(true);
    }
    // ...while a group with more tabs still splits off its own edge.
    const l = applyDrop(one(), "b", { kind: "zone", groupId: "A", zone: "right" }, "N");
    expect(show(l!.root)).toBe("H([a*] [b*])");
    expect(allGroups(l!.root).map((g) => g.id)).toEqual(["A", "N"]);
  });
});
