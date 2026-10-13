import { describe, expect, it } from "vitest";
import {
  capturePathLabel, clampPanel, effectiveDomain, hookUrls, isNotConfigured, PANEL_MIN_PX, panelFraction, panelHeight, parseStatus, relativeTime,
  responseContentType, TREE_MIN_PX,
} from "./webhookModel";

describe("hook URLs", () => {
  it("path form is primary, subdomain form secondary, always https", () => {
    expect(hookUrls("ab12cd34ef", "hooks.test")).toEqual({
      primary: "https://hooks.test/h/ab12cd34ef",
      subdomain: "https://ab12cd34ef.hooks.test/",
    });
  });
});

describe("effective domain", () => {
  const offered = ["hooks.test", "alt.test"];
  it("empty preference = the server's default (the first)", () => {
    expect(effectiveDomain("", offered)).toEqual({ domain: "hooks.test", missing: false, off: false });
  });
  it("a still-offered preference is used", () => {
    expect(effectiveDomain("alt.test", offered)).toEqual({ domain: "alt.test", missing: false, off: false });
  });
  it("a preference the server no longer offers falls back to the default, flagged", () => {
    expect(effectiveDomain("gone.test", offered)).toEqual({ domain: "hooks.test", missing: true, off: false });
  });
  it("no domains: the feature is off", () => {
    expect(effectiveDomain("hooks.test", [])).toEqual({ domain: "", missing: false, off: true });
  });
});

describe("not configured", () => {
  it("is recognised by the code Go marks it with", () => {
    expect(isNotConfigured({ code: "hooks_not_configured" })).toBe(true);
    expect(isNotConfigured({ code: "conflict" })).toBe(false);
    expect(isNotConfigured(undefined)).toBe(false);
  });
});

describe("panel size", () => {
  it("30 % by default, clamped to the panel and tree minimums", () => {
    expect(panelHeight(0.3, 1000)).toBe(300);
    expect(panelHeight(0, 1000)).toBe(300); // invalid → default
    expect(panelHeight(0.05, 1000)).toBe(PANEL_MIN_PX);
    expect(panelHeight(0.95, 1000)).toBe(1000 - TREE_MIN_PX);
  });
  it("a short sidebar keeps the panel minimum (the tree scrolls)", () => {
    expect(panelHeight(0.3, 200)).toBe(PANEL_MIN_PX);
  });
  it("a drag past either end stops at the minimum (never snaps back to the default)", () => {
    expect(clampPanel(5000, 1000)).toBe(1000 - TREE_MIN_PX);
    expect(clampPanel(-300, 1000)).toBe(PANEL_MIN_PX);
    expect(clampPanel(450.6, 1000)).toBe(451);
  });
  it("a drag is stored as a clamped fraction", () => {
    expect(panelFraction(400, 1000)).toBe(0.4);
    expect(panelFraction(10, 1000)).toBe(PANEL_MIN_PX / 1000);
    expect(panelFraction(990, 1000)).toBe((1000 - TREE_MIN_PX) / 1000);
    expect(panelFraction(100, 0)).toBe(0.3);
  });
});

describe("status input", () => {
  it.each([
    ["201", 201], [" 599 ", 599], ["100", 100],
  ])("accepts %s", (text, n) => expect(parseStatus(text)).toEqual({ ok: true, status: n }));
  it.each(["99", "600", "", "2o1", "20.5", "-200"])("rejects %s", (text) => expect(parseStatus(text).ok).toBe(false));
});

describe("capture rows", () => {
  it("path plus query", () => {
    expect(capturePathLabel({ path: "/payme/callback", query: "a=1" })).toBe("/payme/callback?a=1");
    expect(capturePathLabel({ path: "/", query: "" })).toBe("/");
    expect(capturePathLabel({ path: "", query: "" })).toBe("/");
  });
  it("relative time", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(relativeTime("2026-10-13T12:00:00Z", now)).toBe("just now");
    expect(relativeTime("2026-10-13T11:59:30Z", now)).toBe("30s ago");
    expect(relativeTime("2026-10-13T11:55:00Z", now)).toBe("5m ago");
    expect(relativeTime("2026-10-13T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-10-11T12:00:00Z", now)).toBe("2d ago");
    expect(relativeTime("garbage", now)).toBe("");
  });
  it("the configured Content-Type (last enabled row wins)", () => {
    expect(responseContentType([
      { key: "content-type", value: "text/plain", enabled: true },
      { key: "Content-Type", value: "application/json", enabled: true },
      { key: "Content-Type", value: "text/html", enabled: false },
    ])).toBe("application/json");
  });
});
