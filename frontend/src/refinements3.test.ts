import { describe, expect, it, vi } from "vitest";
import { clampSidebar, SIDEBAR_DEFAULT, SIDEBAR_MIN } from "./layout";
import { MENU_MARGIN, menuPosition } from "./menuPosition";
import {
  bodyText, defaultView, effectiveView, isHTML, previewFrameAttrs, ResponseLike, toolbarControls, viewAvailability,
} from "./responseView";
import type { TreeNode } from "./tree";
import { duplicateAndOpen } from "./treeActions";
import { canUseTreeKeys, isEditableTarget, navigate, shortcutApplies, treeShortcut, visibleRows } from "./treeNav";

describe("sidebar width", () => {
  it("clamps to [180, half the window]", () => {
    expect(clampSidebar(SIDEBAR_DEFAULT, 1400)).toBe(260);
    expect(clampSidebar(100, 1400)).toBe(SIDEBAR_MIN);
    expect(clampSidebar(900, 1400)).toBe(700);
    expect(clampSidebar(300.6, 1400)).toBe(301);
    expect(clampSidebar(300, 300)).toBe(SIDEBAR_MIN); // tiny window: the minimum wins
  });
});

describe("context menu position", () => {
  const view = { width: 1000, height: 800 };
  const menu = { width: 200, height: 300 };
  it("puts the top-left corner at the cursor", () => {
    expect(menuPosition({ x: 100, y: 120 }, menu, view)).toEqual({ x: 100, y: 120 });
  });
  it("flips left at the right edge and up at the bottom edge, still touching the cursor", () => {
    expect(menuPosition({ x: 900, y: 120 }, menu, view)).toEqual({ x: 700, y: 120 });
    expect(menuPosition({ x: 100, y: 700 }, menu, view)).toEqual({ x: 100, y: 400 });
    // Bottom-right corner: both axes flip — the menu's bottom-right corner is at the cursor.
    expect(menuPosition({ x: 990, y: 790 }, menu, view)).toEqual({ x: 790, y: 490 });
  });
  it("fits exactly at the edge without flipping", () => {
    expect(menuPosition({ x: 1000 - MENU_MARGIN - 200, y: 0 }, menu, view).x).toBe(796);
  });
  it("when neither side fits, clamps as close to the cursor as stays fully visible", () => {
    // 220 x 310 window, 200 x 300 menu: right/bottom edge at window - margin.
    expect(menuPosition({ x: 50, y: 50 }, { width: 200, height: 300 }, { width: 220, height: 310 }))
      .toEqual({ x: 220 - MENU_MARGIN - 200, y: 310 - MENU_MARGIN - 300 });
    // Larger than the window: pinned to the margin.
    expect(menuPosition({ x: 50, y: 50 }, { width: 300, height: 400 }, { width: 220, height: 310 }))
      .toEqual({ x: MENU_MARGIN, y: MENU_MARGIN });
  });
});

describe("tree keyboard model", () => {
  const req = (id: string, folderId: string | null = null): TreeNode =>
    ({ kind: "request", id, folderId, name: id, method: "GET", url: "", sortOrder: 0, settings: { follow_redirects: "inherit" } });
  const root: TreeNode[] = [
    { kind: "folder", id: "f1", parentId: null, name: "f1", sortOrder: 0, settings: { follow_redirects: "inherit" }, children: [req("r1", "f1"), req("r2", "f1")] },
    { kind: "folder", id: "f2", parentId: null, name: "f2", sortOrder: 1, settings: { follow_redirects: "inherit" }, children: [] },
    req("r3"),
  ];
  const open = new Set(["f1"]);
  const rows = visibleRows(root, (id) => open.has(id));

  it("lists visible rows in screen order (collapsed children hidden)", () => {
    expect(rows.map((r) => r.id)).toEqual(["f1", "r1", "r2", "f2", "r3"]);
    expect(rows[1].parentId).toBe("f1");
    expect(visibleRows(root, () => false).map((r) => r.id)).toEqual(["f1", "f2", "r3"]);
  });
  it("Up/Down move the selection; nothing selected starts at the ends", () => {
    expect(navigate(rows, "r1", "ArrowDown")).toEqual({ type: "select", id: "r2" });
    expect(navigate(rows, "r1", "ArrowUp")).toEqual({ type: "select", id: "f1" });
    expect(navigate(rows, "r3", "ArrowDown")).toBeNull();
    expect(navigate(rows, "f1", "ArrowUp")).toBeNull();
    expect(navigate(rows, undefined, "ArrowDown")).toEqual({ type: "select", id: "f1" });
    expect(navigate(rows, undefined, "ArrowUp")).toEqual({ type: "select", id: "r3" });
    expect(navigate(rows, "r1", "End")).toEqual({ type: "select", id: "r3" });
  });
  it("Right expands a folder, then enters it; Left collapses, then goes to the parent", () => {
    expect(navigate(rows, "f2", "ArrowRight")).toEqual({ type: "expand", id: "f2" });
    expect(navigate(rows, "f1", "ArrowRight")).toEqual({ type: "select", id: "r1" });
    expect(navigate(rows, "r1", "ArrowRight")).toBeNull();
    expect(navigate(rows, "f1", "ArrowLeft")).toEqual({ type: "collapse", id: "f1" });
    expect(navigate(rows, "r2", "ArrowLeft")).toEqual({ type: "select", id: "f1" });
    expect(navigate(rows, "r3", "ArrowLeft")).toBeNull();
    const emptyOpen = visibleRows(root, (id) => id === "f2");
    expect(navigate(emptyOpen, "f2", "ArrowRight")).toBeNull(); // expanded but empty
  });
  it("Enter opens a request and toggles a folder", () => {
    expect(navigate(rows, "r2", "Enter")).toEqual({ type: "open", id: "r2" });
    expect(navigate(rows, "f2", "Enter")).toEqual({ type: "toggle", id: "f2" });
  });
  it("maps Ctrl+E / Del / Ctrl+D (Cmd on macOS) and nothing else", () => {
    const k = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) =>
      treeShortcut({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
    expect(k("e", { ctrlKey: true })).toBe("rename");
    expect(k("E", { metaKey: true })).toBe("rename");
    expect(k("d", { ctrlKey: true })).toBe("duplicate");
    expect(k("Delete")).toBe("delete");
    expect(k("e")).toBeNull();
    expect(k("Delete", { ctrlKey: true })).toBeNull();
    expect(k("d", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(k("Backspace")).toBeNull();
  });
  it("Duplicate is a no-op on folders; rename/delete apply to both", () => {
    expect(shortcutApplies("duplicate", "folder")).toBe(false);
    expect(shortcutApplies("duplicate", "request")).toBe(true);
    expect(shortcutApplies("rename", "folder")).toBe(true);
    expect(shortcutApplies("delete", "folder")).toBe(true);
  });
  it("never fires from the rename input, an editor, or with a modal open", () => {
    const treeTarget = { tagName: "UL", closest: () => null };
    const inEditor = { tagName: "DIV", isContentEditable: true, closest: (s: string) => (s === ".cm-editor" ? {} : null) };
    expect(canUseTreeKeys({ modalOpen: false, renaming: false, target: treeTarget })).toBe(true);
    expect(canUseTreeKeys({ modalOpen: true, renaming: false, target: treeTarget })).toBe(false);
    expect(canUseTreeKeys({ modalOpen: false, renaming: true, target: treeTarget })).toBe(false);
    expect(canUseTreeKeys({ modalOpen: false, renaming: false, target: { tagName: "INPUT" } })).toBe(false);
    expect(canUseTreeKeys({ modalOpen: false, renaming: false, target: inEditor })).toBe(false);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SPAN", closest: (s: string) => (s === ".cm-editor" ? {} : null) })).toBe(true);
    expect(isEditableTarget({ tagName: "LI", closest: () => null })).toBe(false);
  });
});

describe("duplicate request flow", () => {
  it("one bound call, then re-fetch, then select + open the copy (in that order)", async () => {
    const calls: string[] = [];
    const deps = {
      duplicate: vi.fn(async (id: string) => {
        calls.push(`duplicate ${id}`);
        return { data: { id: "copy-1" } };
      }),
      reload: vi.fn(async () => void calls.push("reload")),
      select: vi.fn((id: string) => void calls.push(`select ${id}`)),
      open: vi.fn((id: string) => void calls.push(`open ${id}`)),
    };
    expect(await duplicateAndOpen("r1", deps)).toBeUndefined();
    expect(calls).toEqual(["duplicate r1", "reload", "select copy-1", "open copy-1"]);
    expect(deps.duplicate).toHaveBeenCalledTimes(1);
  });
  it("on failure surfaces the one problem and touches nothing else", async () => {
    const problem = { kind: "server", status: 422, code: "validation_failed", message: "name too long" };
    const deps = {
      duplicate: vi.fn(async () => ({ data: null, error: problem })),
      reload: vi.fn(async () => {}),
      select: vi.fn(),
      open: vi.fn(),
    };
    expect(await duplicateAndOpen("r1", deps)).toBe(problem);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.select).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
  });
});

describe("response views", () => {
  const html: ResponseLike = { contentType: "text/html; charset=utf-8", formatted: false, body: "<h1>Hi</h1>" };
  const json: ResponseLike = { contentType: "application/json", formatted: true, body: "{\n  \"a\": 1\n}", rawBody: "{\"a\":1}" };
  const text: ResponseLike = { contentType: "text/plain", formatted: false, body: "hello" };

  it("offers Preview only for text/html (disabled, not absent, otherwise)", () => {
    expect(isHTML("TEXT/HTML")).toBe(true);
    expect(viewAvailability(html).preview.enabled).toBe(true);
    expect(viewAvailability(json).preview).toEqual({ enabled: false, title: "Only for HTML responses" });
    expect(viewAvailability(text).preview.enabled).toBe(false);
    expect(Object.keys(viewAvailability(text))).toEqual(["pretty", "raw", "preview"]);
  });
  it("Pretty only for formatted JSON; Raw always", () => {
    expect(viewAvailability(json).pretty.enabled).toBe(true);
    expect(viewAvailability(text).pretty.enabled).toBe(false);
    expect(viewAvailability(html).raw.enabled).toBe(true);
    expect(viewAvailability(undefined).raw.enabled).toBe(false);
  });
  it("defaults: Preview for HTML, Pretty for JSON, Raw otherwise; a choice holds while valid", () => {
    expect(defaultView(html)).toBe("preview");
    expect(defaultView(json)).toBe("pretty");
    expect(defaultView(text)).toBe("raw");
    expect(effectiveView(json, "raw")).toBe("raw");
    expect(effectiveView(json, "preview")).toBe("pretty"); // not offered → default
  });
  it("Raw shows the body as received", () => {
    expect(bodyText(json, "raw")).toBe("{\"a\":1}");
    expect(bodyText(json, "pretty")).toBe(json.body);
    expect(bodyText(text, "raw")).toBe("hello");
  });
  it("the preview iframe has an EMPTY sandbox: no scripts, no same-origin", () => {
    const attack = "<p>hi</p><script>document.body.innerHTML='PWNED'</script>";
    const attrs = previewFrameAttrs(attack);
    expect(attrs.sandbox).toBe("");
    expect(attrs.sandbox).not.toContain("allow-scripts");
    expect(attrs.sandbox).not.toContain("allow-same-origin");
    expect(attrs.srcdoc).toBe(attack); // rendered inert by the sandbox, not by rewriting
    expect(attrs.referrerpolicy).toBe("no-referrer");
    expect(Object.keys(attrs).sort()).toEqual(["referrerpolicy", "sandbox", "srcdoc", "title"]);
  });
});

describe("response toolbar: disable, never hide", () => {
  it("Wrap and the view switcher are disabled in Headers mode", () => {
    const c = toolbarControls({ hasResponse: true, section: "headers", view: "pretty" });
    expect(c.views).toEqual({ enabled: false, title: "Applies to body view" });
    expect(c.wrap).toEqual({ enabled: false, title: "Applies to body view" });
    expect(c.sections.enabled).toBe(true);
  });
  it("Wrap is disabled in Preview, enabled in Pretty/Raw", () => {
    expect(toolbarControls({ hasResponse: true, section: "body", view: "preview" }).wrap.enabled).toBe(false);
    expect(toolbarControls({ hasResponse: true, section: "body", view: "raw" }).wrap.enabled).toBe(true);
    expect(toolbarControls({ hasResponse: true, section: "body", view: "pretty" }).views.enabled).toBe(true);
  });
  it("everything is present but disabled before the first response", () => {
    const c = toolbarControls({ hasResponse: false, section: "body", view: "raw" });
    expect([c.sections.enabled, c.views.enabled, c.wrap.enabled]).toEqual([false, false, false]);
  });
});
