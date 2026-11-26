import { describe, expect, it, vi } from "vitest";

const setHeight = vi.fn();
vi.mock("../wailsjs/go/main/App", () => ({
  SetScriptEditorHeight: (k: string, px: number) => setHeight(k, px),
  GetUIPrefs: async () => ({}), SetBulkMode: async () => ({}), SetResponseWrap: async () => ({}), SetSidebarWidth: async () => ({}),
  GetScriptAPIDocs: async () => [],
}));

import type { scripting } from "../wailsjs/go/models";
import { buildMembers, envKeySpot, hoverDoc, insertion, memberAt, memberOptions, whereOf } from "./scriptComplete";
import { groupDocs } from "./scriptDocs";
import { clampScriptHeight, SCRIPT_HEIGHT_DEFAULT, shownScriptHeight, storedScriptHeight } from "./scriptResize";
import { saveScriptHeight, scriptHeight } from "./uiPrefs";
import { varOptions } from "./varComplete";

const doc = (name: string, usage: string, where = "", returns = "void") =>
  ({ group: name.split(".").slice(0, 2).join("."), name, usage, summary: `about ${name}`, example: `${usage}`, where, returns }) as scripting.Doc;

// A slice of the real registry shape (Go: scripting.APIDocs).
const docs = [
  doc("gm.environment.get", "gm.environment.get(key)", "", "string | null"),
  doc("gm.environment.set", "gm.environment.set(key, value)"),
  doc("gm.request.headers.get", "gm.request.headers.get(name)", "", "string | null"),
  doc("gm.request.headers.set", "gm.request.headers.set(name, value)", "pre"),
  doc("gm.response.status", "gm.response.status", "post", "number"),
  doc("gm.response.json", "gm.response.json()", "post", "any"),
  doc("gm.crypto.hmacSHA256", "gm.crypto.hmacSHA256(message, secret)", "", "string (hex)"),
  doc("gm.crypto.hmacSHA1", "gm.crypto.hmacSHA1(message, secret)", "", "string (hex)"),
  doc("gm.console.log", "console.log(...values)"),
];
const root = buildMembers(docs);

describe("gm completion: phase, signatures, insertion", () => {
  it("gm. offers the namespaces; gm.response is post-only as a whole", () => {
    expect(memberOptions(root, ["gm"])!.map((o) => o.label)).toEqual(["environment", "request", "response", "crypto", "console"]);
    expect(whereOf(root.children.get("gm")!.children.get("response")!)).toBe("post");
    expect(whereOf(root.children.get("gm")!.children.get("request")!)).toBe(""); // some members of both kinds
  });

  it("PRE editor: gm.response is offered but marked, dimmed and last", () => {
    const pre = memberOptions(root, ["gm"], "pre")!;
    expect(pre.map((o) => o.label)).toEqual(["environment", "request", "crypto", "console", "response"]);
    const response = pre.find((o) => o.label === "response")!;
    expect(response).toMatchObject({ outOfPhase: true, detail: "object · post only" });
    expect(memberOptions(root, ["gm", "response"], "pre")!.every((o) => o.outOfPhase)).toBe(true);
    expect(memberOptions(root, ["gm", "response"], "post")!.some((o) => o.outOfPhase)).toBe(false);
  });

  it("POST editor: gm.request mutators are marked (pre only); readers are not", () => {
    const headers = memberOptions(root, ["gm", "request", "headers"], "post")!;
    expect(headers.map((o) => `${o.label}:${o.outOfPhase}`)).toEqual(["get:false", "set:true"]);
    expect(headers[1].detail).toBe("(name, value) → void · pre only");
  });

  it("signature + return shape in the detail; summary, returns, example in the info", () => {
    const hmac = memberOptions(root, ["gm", "crypto"], "pre")!;
    expect(hmac.map((o) => `${o.label} ${o.detail}`)).toEqual([
      "hmacSHA256 (message, secret) → string (hex)", "hmacSHA1 (message, secret) → string (hex)",
    ]);
    expect(hmac[0].info).toBe("about gm.crypto.hmacSHA256\nReturns: string (hex)\ne.g. gm.crypto.hmacSHA256(message, secret)");
    expect(memberOptions(root, ["gm", "response"])!.find((o) => o.label === "status")!.detail).toBe("number"); // a property
  });

  it("accepting a function inserts name() with the cursor inside; a property or an existing ( just the name", () => {
    expect(insertion("hmacSHA256", true, "")).toEqual({ text: "hmacSHA256()", cursor: 11 });
    expect(insertion("hmacSHA256", true, "(")).toEqual({ text: "hmacSHA256", cursor: 10 });
    expect(insertion("status", false, "")).toEqual({ text: "status", cursor: 6 });
  });
});

describe("env keys inside gm.environment.get(\"…", () => {
  it("only in the first string argument of get / set / unset", () => {
    expect(envKeySpot('const t = gm.environment.get("TO')).toEqual({ prefix: "TO", start: 30 });
    expect(envKeySpot("gm.environment.set('")).toEqual({ prefix: "", start: 20 });
    expect(envKeySpot("gm.environment.unset(`A")).toEqual({ prefix: "A", start: 22 });
    expect(envKeySpot('gm.environment.get("TOKEN")')).toBeNull(); // closed
    expect(envKeySpot('gm.environment.set("a", "b')).toBeNull(); // the value, not the key
    expect(envKeySpot('gm.request.headers.get("X')).toBeNull();
    expect(envKeySpot('gm.environment.get(name + "')).toBeNull();
  });

  it("the {{var}} grouping: the active environment's keys first, others dimmed", () => {
    const env = {
      envName: "dev",
      vars: new Map([["TOKEN", { key: "TOKEN", value: "t", secret: true, resolved: true }]]),
      keys: [{ key: "TOKEN", secret: true, envs: ["dev"] }, { key: "TOKEN_PROD", secret: false, envs: ["prod"] }],
    };
    const { options } = varOptions({ env: env as never, keys: env.keys }, "TOK");
    expect(options.map((o) => `${o.key}:${o.group}`)).toEqual(["TOKEN:available", "TOKEN_PROD:unavailable"]);
  });
});

describe("hover docs", () => {
  it("the member under the pointer, through the hovered segment", () => {
    const line = 'gm.environment.set("token", x); console.log(1)';
    expect(memberAt(line, 16)?.path).toEqual(["gm", "environment", "set"]); // on "set"
    expect(memberAt(line, 5)?.path).toEqual(["gm", "environment"]); // on "environment"
    expect(memberAt(line, 41)?.path).toEqual(["console", "log"]); // on "log"
    expect(memberAt(line, 34)?.path).toEqual(["console"]);
    expect(memberAt(line, 19)).toBeNull(); // the string's quote
  });

  it("the registry entry, flagged when out of the editor's phase; console.* is gm.console.*", () => {
    expect(hoverDoc(root, ["gm", "environment", "set"], "pre")).toEqual({
      title: "gm.environment.set(key, value)", returns: "void", summary: "about gm.environment.set",
      example: "gm.environment.set(key, value)", where: "", outOfPhase: false,
    });
    expect(hoverDoc(root, ["gm", "response", "json"], "pre")).toMatchObject({ outOfPhase: true, where: "post-response scripts only" });
    expect(hoverDoc(root, ["console", "log"])?.title).toBe("console.log(...values)");
    expect(hoverDoc(root, ["gm", "crypto"])?.summary).toBe("Members: hmacSHA256, hmacSHA1");
    expect(hoverDoc(root, ["window", "x"])).toBeNull();
  });

  it("the ? popover renders from the same registry (grouped in order, nothing lost)", () => {
    const groups = groupDocs(docs);
    expect(groups.map((g) => g.group)).toEqual(["gm.environment", "gm.request", "gm.response", "gm.crypto", "gm.console"]);
    expect(groups.flatMap((g) => g.docs)).toEqual(docs);
  });
});

describe("script editor resize", () => {
  it("clamps to [80 px, 60 % of the pane]; a tiny pane keeps the minimum", () => {
    expect(clampScriptHeight(50, 600)).toBe(80);
    expect(clampScriptHeight(500, 600)).toBe(360);
    expect(clampScriptHeight(250, 600)).toBe(250);
    expect(clampScriptHeight(250, 100)).toBe(80);
    expect(shownScriptHeight(0, 600)).toBe(SCRIPT_HEIGHT_DEFAULT); // unset = the default
    expect(shownScriptHeight(500, 600)).toBe(360); // a saved height is re-clamped to the pane as it is now
  });

  it("persists per kind; the default (and a double-click reset) saves 0", () => {
    saveScriptHeight("pre", storedScriptHeight(240));
    expect(setHeight).toHaveBeenLastCalledWith("pre", 240);
    expect(scriptHeight("pre")).toBe(240);
    expect(scriptHeight("post")).toBe(0);
    saveScriptHeight("pre", storedScriptHeight(SCRIPT_HEIGHT_DEFAULT));
    expect(setHeight).toHaveBeenLastCalledWith("pre", 0);
  });
});
