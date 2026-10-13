import { describe, expect, it, vi } from "vitest";

vi.mock("../wailsjs/go/main/App", () => ({ GetScriptAPIDocs: vi.fn(async () => []) }));

import { buildTree } from "./tree";
import { hasScripts, scriptChain } from "./scriptChain";
import { consoleBadge, consoleGroups } from "./consoleView";
import { groupDocs, whereLabel } from "./scriptDocs";
import type { scripting } from "../wailsjs/go/models";

describe("folder script chain", () => {
  const tree = buildTree(
    [
      { id: "outer", name: "api", sort_order: 0, pre_script: "outer()", post_script: "" },
      { id: "mid", parent_id: "outer", name: "v2", sort_order: 0 },
      { id: "inner", parent_id: "mid", name: "orders", sort_order: 0, pre_script: "", post_script: "inner()" },
    ],
    [
      { id: "r1", folder_id: "inner", name: "Create", method: "POST", url: "", sort_order: 0 },
      { id: "root", folder_id: null, name: "Ping", method: "GET", url: "", sort_order: 0 },
    ],
  );
  it("lists every ancestor folder OUTERMOST first, with its scripts (they accumulate)", () => {
    expect(scriptChain(tree, "r1")).toEqual([
      { name: "api", pre_script: "outer()", post_script: "" },
      { name: "v2", pre_script: "", post_script: "" },
      { name: "orders", pre_script: "", post_script: "inner()" },
    ]);
  });
  it("is empty at the project root or for an unknown request", () => {
    expect(scriptChain(tree, "root")).toEqual([]);
    expect(scriptChain(tree, "gone")).toEqual([]);
  });
  it("the Scripts sub-tab dot means the request has a script of its own", () => {
    expect(hasScripts({ pre_script: "", post_script: "" })).toBe(false);
    expect(hasScripts({ pre_script: "  \n", post_script: "" })).toBe(false);
    expect(hasScripts({ pre_script: "", post_script: "x()" })).toBe(true);
  });
});

describe("console view model", () => {
  const e = (owner: string, phase: string, level: string, text: string) => ({ owner, phase, level, text }) as scripting.Entry;
  const c = {
    entries: [
      e("folder 'api'", "pre", "log", "a"), e("folder 'api'", "pre", "log", "b"), e("request 'Login'", "pre", "warn", "c"),
      e("request 'Login'", "post", "error", "boom"),
    ],
    truncated: false,
  } as scripting.Console;
  it("badge: count of entries, red when any is an error", () => {
    expect(consoleBadge(c)).toEqual({ count: 4, error: true });
    expect(consoleBadge({ entries: [e("x", "pre", "log", "a")], truncated: false } as scripting.Console)).toEqual({ count: 1, error: false });
    expect(consoleBadge(undefined)).toEqual({ count: 0, error: false });
  });
  it("groups consecutive entries per script, in run order", () => {
    expect(consoleGroups(c).map((g) => [g.label, g.entries.length])).toEqual([
      ["Pre-request · folder 'api'", 2], ["Pre-request · request 'Login'", 1], ["Post-response · request 'Login'", 1],
    ]);
    expect(consoleGroups(null)).toEqual([]);
  });
});

describe("gm API help", () => {
  it("groups the docs in order and labels where they apply", () => {
    const d = (group: string, name: string, where = "") => ({ group, name, usage: name, summary: "", example: "", where }) as scripting.Doc;
    expect(groupDocs([d("gm.environment", "a"), d("gm.environment", "b"), d("gm.request", "c")]).map((g) => [g.group, g.docs.length]))
      .toEqual([["gm.environment", 2], ["gm.request", 1]]);
    expect(whereLabel("post")).toBe("post-response scripts only");
    expect(whereLabel("")).toBe("");
  });
});

describe("Scripts sub-tab save wiring", () => {
  it("a stored request's scripts load into the draft the autosave diffs (Go: BuildRequestPatch)", async () => {
    const { draftFromRequest } = await import("./tabsController");
    const d = draftFromRequest({ method: "GET", url: "x", pre_script: "a()", post_script: "b()" } as never);
    expect([d.pre_script, d.post_script]).toEqual(["a()", "b()"]);
    expect(draftFromRequest({ method: "GET", url: "x" } as never).pre_script).toBe("");
  });
});
