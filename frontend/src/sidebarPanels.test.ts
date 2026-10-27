import { describe, expect, it } from "vitest";
import { anyExpanded, areaHeight, DEFAULT_PANELS, expandSection, normalizePanels, SECTIONS, toggleSection } from "./sidebarPanels";
import { PANEL_MIN_PX, TREE_MIN_PX } from "./webhookModel";

describe("sidebar bottom sections", () => {
  it("a fixed order: Webhooks, then Proxies; both collapsed by default", () => {
    expect(SECTIONS).toEqual(["webhooks", "proxies"]);
    expect(anyExpanded(DEFAULT_PANELS)).toBe(false);
  });
  it("sections toggle independently; expanding an expanded one is a no-op", () => {
    const one = toggleSection(DEFAULT_PANELS, "proxies");
    expect(one).toEqual({ ...DEFAULT_PANELS, proxies: true });
    const both = toggleSection(one, "webhooks");
    expect(both).toMatchObject({ webhooks: true, proxies: true });
    expect(toggleSection(both, "proxies")).toMatchObject({ webhooks: true, proxies: false });
    expect(expandSection(both, "webhooks")).toBe(both);
  });
  it("the area is just the bars when nothing is expanded, else the stored height within the minimums", () => {
    expect(areaHeight(DEFAULT_PANELS, 1000)).toBeUndefined();
    expect(areaHeight({ ...DEFAULT_PANELS, webhooks: true, fraction: 0.4 }, 1000)).toBe(400);
    expect(areaHeight({ ...DEFAULT_PANELS, proxies: true, fraction: 0.99 }, 1000)).toBe(1000 - TREE_MIN_PX);
    expect(areaHeight({ ...DEFAULT_PANELS, proxies: true, fraction: 0.01 }, 1000)).toBe(PANEL_MIN_PX);
  });
  it("persisted state is normalized (a bad fraction → the default)", () => {
    expect(normalizePanels({ webhooks: true, proxies: true, fraction: 0.45 })).toEqual({ webhooks: true, proxies: true, fraction: 0.45 });
    expect(normalizePanels({ fraction: 3 })).toEqual(DEFAULT_PANELS);
    expect(normalizePanels(undefined)).toEqual(DEFAULT_PANELS);
  });
});
