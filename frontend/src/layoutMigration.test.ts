import { describe, expect, it } from "vitest";
import { restoreLayout } from "./layoutPersistence";
import { allGroups, allTabs } from "./layoutTree";

// A layout saved by a build that still had the "Proxies" list tab (proxy_list):
// one group with it next to a request, and a split group holding only it.
const stored = JSON.stringify({
  version: 1,
  layout: {
    focusedGroupId: "g2",
    root: {
      type: "split", id: "s1", direction: "horizontal", sizes: [0.5, 0.5],
      children: [
        { type: "group", id: "g1", tabs: ["request:r1", "proxy_list:", "proxy:x1"], activeTabId: "proxy_list:" },
        { type: "group", id: "g2", tabs: ["proxy_list:"], activeTabId: "proxy_list:" },
      ],
    },
  },
});

describe("layout restore drops the retired proxy_list tab", () => {
  it("keeps the other tabs, collapses the emptied group, writes the clean layout back once — no crash", async () => {
    const writes: string[] = [];
    const storage = { get: async () => stored, set: async (_: string, json: string) => void writes.push(json) };
    const loaded: string[] = [];
    const layout = await restoreLayout(storage, "p1", async (ref) => {
      loaded.push(`${ref.kind}:${ref.id}`);
      return true;
    });
    expect(allTabs(layout.root)).toEqual(["request:r1", "proxy:x1"]);
    expect(allGroups(layout.root)).toHaveLength(1);
    expect(loaded).not.toContain("proxy_list:");
    const g = allGroups(layout.root)[0];
    expect(g.activeTabId).toBe("request:r1"); // the retired active tab falls back to the first tab
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("proxy_list");
  });

  it("a clean stored layout is not rewritten", async () => {
    const writes: string[] = [];
    const first = { get: async () => stored, set: async (_: string, json: string) => void writes.push(json) };
    await restoreLayout(first, "p1", async () => true);
    const clean = writes[0];
    const again: string[] = [];
    await restoreLayout({ get: async () => clean, set: async (_: string, json: string) => void again.push(json) }, "p1", async () => true);
    expect(again).toHaveLength(0);
  });
});
