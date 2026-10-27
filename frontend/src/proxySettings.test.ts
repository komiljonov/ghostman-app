import { describe, expect, it } from "vitest";
import { isGlobalDefault, setDefaultEntry, choiceToSave, describeProxy, effectiveProxy, globalChoice, passwordStatus, proxyOptions, proxyOverrides, shownProxy } from "./proxySettings";
import { ProxyLevel, resolveProxy } from "./settingsResolver";
import { buildTree } from "./tree";

const proxies = [{ id: "corp", name: "Corp proxy" }, { id: "squid", name: "Local squid" }];
const known = (id: string) => proxies.some((p) => p.id === id);
const lvl = (id: string, mode: string, proxyId: string | null = null, kind: "request" | "folder" = "folder"): ProxyLevel =>
  ({ id, kind, name: id, proxy: { mode, proxyId } });

describe("resolveProxy matrix", () => {
  const req = (mode: string, id: string | null = null) => lvl("req", mode, id, "request");
  it.each([
    // [request, folders bottom-up, global default, → proxy, source]
    ["own proxy", req("proxy", "squid"), [lvl("api", "none")], "corp", "squid", "this request"],
    ["none stops the chain", req("none"), [lvl("api", "proxy", "corp")], "corp", null, "this request"],
    ["global stops, uses the global default", req("global"), [lvl("api", "proxy", "squid")], "corp", "corp", "global"],
    ["inherit walks to a folder", req("inherit"), [lvl("api", "proxy", "corp")], "none", "corp", "from folder ‘api’"],
    ["inherit walks past none-less folders", req("inherit"), [lvl("inner", "inherit"), lvl("outer", "none")], "corp", null, "from folder ‘outer’"],
    ["chain end → global default", req("inherit"), [lvl("api", "inherit")], "squid", "squid", "global"],
    ["chain end, global none → direct", req("inherit"), [], "none", null, "global"],
    ["a deleted proxy is inherit", req("proxy", "gone"), [lvl("api", "proxy", "corp")], "none", "corp", "from folder ‘api’"],
    ["a null id (deleted on the server) is inherit", req("proxy", null), [], "squid", "squid", "global"],
    ["a deleted global default reads as none", req("global"), [], "gone", null, "global"],
    ["unknown modes are inherit", req("sideways"), [lvl("api", "proxy", "squid")], "none", "squid", "from folder ‘api’"],
  ] as const)("%s", (_, node, ancestors, global, wantId, wantSource) => {
    const r = resolveProxy(node, [...ancestors], global, known);
    expect(r.proxyId).toBe(wantId);
    expect(r.source.kind === "global" ? "global" : r.source.kind === "node" && r.source.nodeKind === "folder" ? `from folder ‘${r.source.name}’` : "this request").toBe(wantSource);
  });
});

describe("Settings row labels", () => {
  const tree = buildTree(
    [{ id: "f1", name: "api", sort_order: 0, proxy: { mode: "proxy", proxy_id: "corp" } }, { id: "f2", parent_id: "f1", name: "v2", sort_order: 0 }],
    [{ id: "r1", folder_id: "f2", name: "Login", method: "GET", url: "", sort_order: 0 }, { id: "r2", name: "Root", method: "GET", url: "", sort_order: 0, proxy: { mode: "proxy", proxy_id: "gone" } }],
  );
  it("inherit names what it resolves to and from where; global names the default", () => {
    const opts = proxyOptions(tree, "r1", "squid", proxies);
    expect(opts.map((o) => o.label)).toEqual([
      "Inherit from parent — currently: Corp proxy (from folder ‘api’)",
      "Use global setting — currently: Local squid",
      "No proxy (direct)",
      "Use proxy…",
    ]);
    expect(proxyOptions(tree, "r2", "none", proxies)[0].label).toBe("Inherit from parent — currently: direct (global default)");
  });
  it("a request pointing at a deleted proxy shows (and resolves as) inherit", () => {
    expect(shownProxy({ mode: "proxy", proxyId: "gone" }, proxies)).toEqual({ mode: "inherit", proxyId: null, deleted: true });
    expect(describeProxy(effectiveProxy(tree, "r2", "squid", proxies), proxies)).toBe("Local squid (global default)");
    expect(proxyOverrides({ mode: "proxy", proxyId: "gone" }, proxies)).toBe(false);
  });
  it("labels follow the proxy list live (a renamed / removed proxy)", () => {
    expect(describeProxy(effectiveProxy(tree, "r1", "none", [{ id: "corp", name: "Corp (new)" }]), [{ id: "corp", name: "Corp (new)" }])).toBe("Corp (new) (from folder ‘api’)");
    expect(describeProxy(effectiveProxy(tree, "r1", "none", []), [])).toBe("direct (global default)");
  });
  it("the override dot is on for anything but inherit", () => {
    expect(proxyOverrides({ mode: "inherit", proxyId: null }, proxies)).toBe(false);
    expect(proxyOverrides({ mode: "none", proxyId: null }, proxies)).toBe(true);
    expect(proxyOverrides({ mode: "proxy", proxyId: "corp" }, proxies)).toBe(true);
  });
});

describe("saving a choice", () => {
  it("Use proxy… takes the picked proxy, else the first; none without proxies", () => {
    expect(choiceToSave("proxy", "squid", proxies)).toEqual({ mode: "proxy", proxyId: "squid" });
    expect(choiceToSave("proxy", null, proxies)).toEqual({ mode: "proxy", proxyId: "corp" });
    expect(choiceToSave("proxy", "gone", proxies)).toEqual({ mode: "proxy", proxyId: "corp" });
    expect(choiceToSave("proxy", null, [])).toBeUndefined();
    expect(choiceToSave("none", "squid", proxies)).toEqual({ mode: "none", proxyId: null });
  });
});

describe("global default dropdown", () => {
  it("shows the stored proxy, or No proxy for none / a deleted one", () => {
    expect(globalChoice("squid", proxies)).toBe("squid");
    expect(globalChoice("none", proxies)).toBe("none");
    expect(globalChoice("gone", proxies)).toBe("none");
  });
});

describe("password status (local only)", () => {
  it.each([
    [{ saving: true, set: false, username: "me" }, "Saving on this machine…"],
    [{ saving: false, error: "disk full", set: false, username: "me" }, "Not saved: disk full"],
    [{ saving: false, set: true, username: "me" }, "Saved on this machine — never sent to the server"],
    [{ saving: false, set: false, username: "me" }, "No password on this machine: sends go without credentials"],
    [{ saving: false, set: false, username: "" }, ""],
  ])("%o", (s, want) => expect(passwordStatus(s)).toBe(want));
});

describe("global default marker", () => {
  it("marks only the stored default; none marks nothing", () => {
    expect(isGlobalDefault("squid", "squid")).toBe(true);
    expect(isGlobalDefault("corp", "squid")).toBe(false);
    expect(isGlobalDefault("corp", "none")).toBe(false);
  });
  it("Set as global default is disabled on the current default only", () => {
    expect(setDefaultEntry("squid", "squid")).toEqual({ disabled: true, title: "Already the global default" });
    expect(setDefaultEntry("corp", "squid").disabled).toBe(false);
    expect(setDefaultEntry("corp", "none").disabled).toBe(false);
  });
});
