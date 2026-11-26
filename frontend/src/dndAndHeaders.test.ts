import { describe, expect, it, vi } from "vitest";
import { normalizeAuth } from "./auth";
import {
  bearerTokenOf, convertToApiKey, convertToBearer, isAuthorizationKey, managesAuthorization, showAuthHint,
} from "./authHint";
import { canonicalHeader, COMMON_HEADERS, headerKeyOptions, headerValueOptions, wordBefore } from "./headerComplete";
import { createRowDrag } from "./rowDrag";
import { insertIndex, lineY, reorderByIndex, reorderIds, RowRect, saveOrder } from "./rowOrder";
import type { Row } from "./rows";
import { completionSpot } from "./varComplete";

// Rows a, b, c, d — 20 px each from y = 0.
const rows: RowRect[] = ["a", "b", "c", "d"].map((id, i) => ({ id, top: i * 20, bottom: (i + 1) * 20 }));
const ids = rows.map((r) => r.id);

describe("row order math", () => {
  it("insert index: before the first row whose middle is below the pointer", () => {
    expect(insertIndex(rows, -5)).toBe(0);
    expect(insertIndex(rows, 9)).toBe(0);
    expect(insertIndex(rows, 11)).toBe(1);
    expect(insertIndex(rows, 75)).toBe(4);
    expect(lineY(rows, 1)).toBe(20);
    expect(lineY(rows, 4)).toBe(80);
  });

  it("reorder: the full new order, or null for a no-op", () => {
    expect(reorderIds(ids, "a", 3)).toEqual(["b", "c", "a", "d"]); // down: lands before d
    expect(reorderIds(ids, "a", 4)).toEqual(["b", "c", "d", "a"]); // to the end
    expect(reorderIds(ids, "d", 0)).toEqual(["d", "a", "b", "c"]); // to the top
    expect(reorderIds(ids, "c", 1)).toEqual(["a", "c", "b", "d"]);
    expect(reorderIds(ids, "b", 1)).toBeNull(); // its own place
    expect(reorderIds(ids, "b", 2)).toBeNull(); // the gap right after it
    expect(reorderIds(ids, "x", 0)).toBeNull();
  });

  it("draft rows reorder by index ids", () => {
    expect(reorderByIndex(["h0", "h1", "h2"], ["2", "0", "1"])).toEqual(["h2", "h0", "h1"]);
  });

  it("a saved order re-fetches; a failed save shows its message and the re-fetch restores", async () => {
    const reload = vi.fn();
    const onError = vi.fn();
    const save = vi.fn(async () => ({}));
    expect(await saveOrder(["b", "a"], { save, reload, onError })).toBe(true);
    expect(save).toHaveBeenCalledWith(["b", "a"]);
    expect(onError).toHaveBeenLastCalledWith(undefined);
    expect(reload).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => ({ error: { message: "order must list every environment" } }));
    expect(await saveOrder(["b", "a"], { save: failing, reload, onError })).toBe(false);
    expect(onError).toHaveBeenLastCalledWith("order must list every environment");
    expect(reload).toHaveBeenCalledTimes(2); // the server's order comes back
  });
});

// A pointer gesture over the fake list (node: an EventTarget stands in for the window).
function harness(opts: { handle?: string } = {}) {
  const events = new EventTarget();
  const onDrop = vi.fn();
  const box = { top: 0, bottom: 200, left: 0, width: 100, height: 200, right: 100 };
  const scroller = { scrollTop: 0, getBoundingClientRect: () => box } as unknown as HTMLElement;
  const drag = createRowDrag({
    list: () => ({ getBoundingClientRect: () => box }) as unknown as HTMLElement,
    handle: opts.handle,
    scroller: () => scroller,
    events,
    readRows: () => rows,
    frame: () => () => undefined,
    onDrop,
  });
  // A press on row `id`; `inHandle` says whether the pressed element is inside the handle.
  const press = (id: string, y: number, inHandle = false) => drag.onPointerDown({
    button: 0, clientX: 10, clientY: y,
    target: {
      closest: (sel: string) => (sel === "[data-drag-id]" ? { dataset: { dragId: id }, textContent: id } : sel === opts.handle && inHandle ? {} : null),
    } as unknown as EventTarget,
  });
  const fire = (type: string, props: Record<string, unknown>) => events.dispatchEvent(Object.assign(new Event(type), props));
  return { drag, onDrop, press, move: (y: number) => fire("pointermove", { clientX: 10, clientY: y }), up: () => fire("pointerup", {}), fire };
}

describe("row drag gesture", () => {
  it("a press becomes a drag only after 5 px; a drop hands over the new order", () => {
    const h = harness();
    h.press("a", 5);
    h.move(8); // 3 px: still a click
    expect(h.drag.view()).toBeUndefined();
    h.move(65); // past c's middle: before d
    expect(h.drag.view()).toMatchObject({ draggedId: "a", line: { y: 60 } });
    h.up();
    expect(h.onDrop).toHaveBeenCalledWith(["b", "c", "a", "d"], "a");
    expect(h.drag.consumeClick()).toBe(true); // the click after the drag is swallowed
    expect(h.drag.consumeClick()).toBe(false);
  });

  it("a release under the threshold is a click: no drop, no swallowed click", () => {
    const h = harness();
    h.press("b", 25);
    h.move(27);
    h.up();
    expect(h.onDrop).not.toHaveBeenCalled();
    expect(h.drag.consumeClick()).toBe(false);
  });

  it("Escape cancels; a no-op target shows no line and drops nothing", () => {
    const h = harness();
    h.press("a", 5);
    h.move(60);
    h.fire("keydown", { key: "Escape" });
    expect(h.drag.view()).toBeUndefined();
    h.up();
    expect(h.onDrop).not.toHaveBeenCalled();
    h.press("b", 25);
    h.move(36); // b's own gap
    expect(h.drag.view()?.line).toBeNull();
    h.up();
    expect(h.onDrop).not.toHaveBeenCalled();
  });

  it("handle-only surfaces: a press outside the handle (a cell's text) never starts a drag", () => {
    const h = harness({ handle: ".drag-handle" });
    h.press("a", 5, false);
    h.move(70);
    expect(h.drag.view()).toBeUndefined();
    h.press("a", 5, true);
    h.move(70);
    expect(h.drag.view()?.draggedId).toBe("a");
  });
});

describe("header key completion", () => {
  it("prefix before substring, case-insensitive, canonical casing", () => {
    expect(headerKeyOptions("auth", []).map((o) => o.label)).toEqual(["Authorization"]);
    const ct = headerKeyOptions("content-t", []).map((o) => o.label);
    expect(ct[0]).toBe("Content-Type");
    const type = headerKeyOptions("type", []).map((o) => o.label);
    expect(type).toContain("Content-Type"); // substring match
    expect(headerKeyOptions("x-req", []).map((o) => o.label)).toEqual(["X-Request-ID", "X-Requested-With"]);
    expect(canonicalHeader(" content-type ")).toBe("Content-Type");
    expect(canonicalHeader("x-my-thing")).toBe("x-my-thing");
    expect(COMMON_HEADERS.length).toBeGreaterThanOrEqual(40);
  });

  it("recent keys rank above common ones, each name once; an exact complete match offers nothing", () => {
    const opts = headerKeyOptions("x-", ["X-Tenant", "x-request-id"]);
    expect(opts.slice(0, 2)).toEqual([{ label: "X-Tenant", group: "recent" }, { label: "X-Request-ID", group: "recent" }]);
    expect(opts.filter((o) => o.label === "X-Request-ID")).toHaveLength(1);
    expect(opts.slice(2).every((o) => o.group === "common")).toBe(true);
    expect(headerKeyOptions("", ["X-Tenant"])[0]).toEqual({ label: "X-Tenant", group: "recent" });
    expect(headerKeyOptions("Authorization", [])).toEqual([]);
  });

  it("context: a {{ … stays the var completion's; value cells only for Content-Type", () => {
    // The header sources step aside exactly where the var source answers.
    expect(completionSpot("{{to", "", 4)).not.toBeNull();
    expect(completionSpot("X-Tok", "", 5)).toBeNull();
    expect(wordBefore("Bearer {{a}} X-Tok")).toEqual({ word: "X-Tok", start: 13 });
    expect(headerValueOptions("Content-Type", "app")).toEqual([
      "application/json", "application/x-www-form-urlencoded", "application/xml", "application/octet-stream",
    ]);
    expect(headerValueOptions("content-type", "")).toContain("multipart/form-data");
    expect(headerValueOptions("Accept", "app")).toEqual([]); // value cells never suggest header names / mimes elsewhere
    expect(headerValueOptions("Content-Type", "text/plain")).toEqual([]);
  });
});

describe("auth hint", () => {
  const auth = (over: Partial<ReturnType<typeof normalizeAuth>> = {}) => ({ ...normalizeAuth(), ...over });
  const row = (key: string, value = "Bearer xyz", enabled = true): Row => ({ key, value, enabled });

  it("matrix: own type × key casing × enabled × resolved × dismissal", () => {
    const cases: [Row, string, ReturnType<typeof auth> | null, boolean, boolean][] = [
      [row("Authorization"), "inherit", null, false, true],
      [row("authorization"), "none", null, false, true],
      [row(" AUTHORIZATION "), "inherit", null, false, true],
      [row("Authorization", "x", false), "inherit", null, false, false], // disabled row
      [row("X-Auth"), "inherit", null, false, false],
      [row("Authorization"), "bearer", auth({ type: "bearer" }), false, false], // the request has its own auth
      [row("Authorization"), "inherit", auth({ type: "bearer" }), false, false], // a folder's bearer manages it
      [row("Authorization"), "inherit", auth({ type: "api_key", api_key_in: "header", api_key_name: "X-Key" }), false, true],
      [row("Authorization"), "inherit", auth({ type: "api_key", api_key_in: "header", api_key_name: "authorization" }), false, false],
      [row("Authorization"), "inherit", auth({ type: "jwt", jwt_add_to: "header", jwt_name: "" }), false, false],
      [row("Authorization"), "inherit", auth({ type: "jwt", jwt_add_to: "query" }), false, true],
      [row("Authorization"), "inherit", null, true, false], // dismissed
    ];
    for (const [r, own, resolved, dismissed, want] of cases) {
      expect(showAuthHint(r, auth({ type: own as never }), resolved, dismissed), `${r.key} ${own} ${resolved?.type} ${dismissed}`).toBe(want);
    }
    expect(isAuthorizationKey("Authorization ")).toBe(true);
    expect(managesAuthorization(null)).toBe(false);
  });

  it("Bearer detection", () => {
    expect(bearerTokenOf("Bearer xyz")).toBe("xyz");
    expect(bearerTokenOf("  bearer {{TOKEN}} ")).toBe("{{TOKEN}}");
    expect(bearerTokenOf("Bearer ")).toBeUndefined();
    expect(bearerTokenOf("Token xyz")).toBeUndefined();
  });

  it("conversions: auth set from the row, the row DISABLED (not deleted), the rest untouched", () => {
    const headers: Row[] = [row("Accept", "*/*"), row("Authorization", "Bearer xyz"), row("X-Other", "1")];
    const b = convertToBearer(auth(), headers, 1)!;
    expect(b.auth).toMatchObject({ type: "bearer", bearer_token: "xyz" });
    expect(b.headers).toEqual([headers[0], { ...headers[1], enabled: false }, headers[2]]);
    expect(convertToBearer(auth(), [row("Authorization", "Token abc")], 0)).toBeNull();
    const k = convertToApiKey(auth({ bearer_token: "kept" }), [row(" Authorization", "Token abc")], 0)!;
    expect(k.auth).toMatchObject({ type: "api_key", api_key_name: "Authorization", api_key_value: "Token abc", api_key_in: "header", bearer_token: "kept" });
    expect(k.headers[0].enabled).toBe(false);
    // After either conversion the hint is gone: the request now has its own auth.
    expect(showAuthHint(b.headers[1], b.auth, b.auth, false)).toBe(false);
  });
});
