import { describe, expect, it, vi } from "vitest";
import {
  canOpenOriginal, defaultFilter, entriesToDelete, filterToQuery, formRows, groupByDay, nextCursor,
  restoreAndOpen, rowLabel, statusChip, storageLine, SummaryLike,
} from "./historyModel";

const summary = (over: Partial<SummaryLike>): SummaryLike => ({
  id: 1, created_at: 0, project_id: "p1", request_id: "r1", request_name: "", method: "GET",
  url_template: "", url_resolved: "", env_name: "", status: 200, duration_ms: 5, error: "", ...over,
});

describe("filter -> query", () => {
  it("defaults: current project only, nothing else, first page", () => {
    expect(filterToQuery(defaultFilter(), "p1")).toEqual({
      project_id: "p1", query: "", method: "", status_class: "", before_created: 0, before_id: 0, limit: 100,
    });
  });
  it("maps every control and the cursor", () => {
    const q = filterToQuery({ text: "  users ", method: "POST", status: "err", currentProjectOnly: false }, "p1", { created_at: 5, id: 9 });
    expect(q).toEqual({ project_id: "", query: "users", method: "POST", status_class: "err", before_created: 5, before_id: 9, limit: 100 });
  });
  it("next cursor is the last item", () => {
    expect(nextCursor([])).toBeUndefined();
    expect(nextCursor([{ created_at: 3, id: 2 }, { created_at: 1, id: 7 }])).toEqual({ created_at: 1, id: 7 });
  });
});

describe("list rows", () => {
  it("label: name, else host+path, else the raw url", () => {
    expect(rowLabel(summary({ request_name: " Login " }))).toBe("Login");
    expect(rowLabel(summary({ url_resolved: "https://api.x.io/v1/users?a=1" }))).toBe("api.x.io/v1/users");
    expect(rowLabel(summary({ url_resolved: "https://x.io" }))).toBe("x.io");
    expect(rowLabel(summary({ url_template: "{{BASE}}/users" }))).toBe("{{BASE}}/users");
  });
  it("status chip classes, ERR for failures", () => {
    expect(statusChip({ status: 204, error: "" })).toEqual({ cls: "2xx", text: "204" });
    expect(statusChip({ status: 301, error: "" }).cls).toBe("3xx");
    expect(statusChip({ status: 404, error: "" }).cls).toBe("4xx");
    expect(statusChip({ status: 503, error: "" }).cls).toBe("5xx");
    expect(statusChip({ status: 0, error: "dial tcp: refused" })).toEqual({ cls: "err", text: "ERR" });
  });
  it("groups newest-first items by local day", () => {
    const now = new Date(2026, 9, 7, 15, 0).getTime();
    const at = (d: number, h: number) => ({ created_at: new Date(2026, 9, d, h).getTime() });
    const groups = groupByDay([at(7, 14), at(7, 1), at(6, 23), at(1, 12), at(1, 9)], now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Today", 2], ["Yesterday", 1], [new Date(2026, 9, 1).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), 2],
    ]);
    const old = groupByDay([{ created_at: new Date(2025, 0, 2).getTime() }], now);
    expect(old[0].label).toContain("2025");
  });
});

describe("detail", () => {
  const form = {
    url: "{{B}}/x", body: "hi", body_type: "raw", content_type: "text/plain",
    headers: [{ key: "A", value: "1", enabled: true }, { key: "B", value: "2", enabled: false }, { key: "", value: "", enabled: true }],
    params: [{ key: "q", value: "v", enabled: true }],
  };
  it("template shows every row (disabled marked) and the params", () => {
    const r = formRows(form, "template");
    expect(r.headers).toEqual([{ key: "A", value: "1", off: false }, { key: "B", value: "2", off: true }]);
    expect(r.params).toEqual([{ key: "q", value: "v", off: false }]);
    expect(r.bodyLabel).toBe("text/plain");
  });
  it("resolved has its params in the URL; no body for none", () => {
    expect(formRows(form, "resolved").params).toEqual([]);
    expect(formRows({ ...form, body_type: "none" }, "resolved").body).toBe("");
  });
  it("open original only for a request still in the current project's tree", () => {
    const ids = new Set(["r1"]);
    expect(canOpenOriginal({ project_id: "p1", request_id: "r1" }, "p1", ids).ok).toBe(true);
    expect(canOpenOriginal({ project_id: "p1", request_id: "r2" }, "p1", ids)).toEqual({ ok: false, why: "The original request no longer exists" });
    expect(canOpenOriginal({ project_id: "p2", request_id: "r1" }, "p1", ids).ok).toBe(false);
    expect(canOpenOriginal({ project_id: "", request_id: "" }, "p1", ids).ok).toBe(false);
  });
});

describe("restore", () => {
  it("restores, re-fetches the tree, opens the new request", async () => {
    const calls: string[] = [];
    const err = await restoreAndOpen(7, "p1", {
      restore: async (id, pid) => {
        calls.push(`restore ${id} ${pid}`);
        return { data: { id: "new" } };
      },
      reloadTree: () => calls.push("reload"),
      open: (id) => calls.push(`open ${id}`),
    });
    expect(err).toBeUndefined();
    expect(calls).toEqual(["restore 7 p1", "reload", "open new"]);
  });
  it("a failure opens nothing and returns the message", async () => {
    const open = vi.fn();
    const err = await restoreAndOpen(7, "p1", {
      restore: async () => ({ data: null, error: { message: "no access to this project" } }),
      reloadTree: vi.fn(), open,
    });
    expect(err).toBe("no access to this project");
    expect(open).not.toHaveBeenCalled();
    expect(await restoreAndOpen(7, "", { restore: vi.fn(), reloadTree: vi.fn(), open })).toBe("Select a project first");
  });
});

describe("settings section", () => {
  it("prompts only when lowering below the current count", () => {
    expect(entriesToDelete(250, 100)).toBe(150);
    expect(entriesToDelete(80, 100)).toBe(0);
    expect(entriesToDelete(9000, 0)).toBe(0); // unlimited
  });
  it("storage line", () => {
    expect(storageLine(1234, 5.5 * 1024 * 1024)).toBe("1,234 entries · 5.5 MB");
    expect(storageLine(1, 900)).toBe("1 entry · 900 B");
  });
});
