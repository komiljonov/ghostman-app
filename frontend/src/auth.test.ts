import { describe, expect, it } from "vitest";
import {
  AuthConfig, authRows, effectiveAuthOf, modeOptions, normalizeAuth, overridesSomething, resolvedLabel, withType,
} from "./auth";
import { AuthLevel, resolveAuth, resolveAuthInTree } from "./settingsResolver";
import { buildTree } from "./tree";
import { maskRanges } from "./vars";

const cfg = (over: Partial<AuthConfig>): AuthConfig => ({ ...normalizeAuth(), ...over });
const lvl = (id: string, kind: "request" | "folder", auth: Partial<AuthConfig>): AuthLevel => ({ id, kind, name: id, auth: cfg(auth) });

describe("resolveAuth", () => {
  const bearerFolder = lvl("api", "folder", { type: "bearer", bearer_token: "{{T}}" });
  it("explicit at the node wins; the full config comes back", () => {
    const r = resolveAuth(lvl("r", "request", { type: "basic", basic_username: "u" }), [bearerFolder]);
    expect(r.config?.type).toBe("basic");
    expect(r.config?.basic_username).toBe("u");
    expect(r.source).toEqual({ kind: "node", id: "r", nodeKind: "request", name: "r" });
  });
  it("inherit walks up; the nearest explicit folder wins", () => {
    const r = resolveAuth(lvl("r", "request", { type: "inherit" }), [
      lvl("inner", "folder", { type: "inherit" }), lvl("mid", "folder", { type: "api_key", api_key_name: "k" }), bearerFolder,
    ]);
    expect(r.config?.type).toBe("api_key");
    expect(r.source).toMatchObject({ kind: "node", id: "mid" });
  });
  it("none STOPS the chain: no auth even under a bearer folder, source = that node", () => {
    const r = resolveAuth(lvl("r", "request", { type: "none" }), [bearerFolder]);
    expect(r).toEqual({ config: null, source: { kind: "node", id: "r", nodeKind: "request", name: "r" } });
    const viaFolder = resolveAuth(lvl("r", "request", { type: "inherit" }), [lvl("x", "folder", { type: "none" }), bearerFolder]);
    expect(viaFolder.config).toBeNull();
    expect(viaFolder.source).toMatchObject({ id: "x" });
  });
  it("inherit all the way up falls through to no auth (source = default)", () => {
    const r = resolveAuth(lvl("r", "request", { type: "inherit" }), [lvl("f", "folder", { type: "inherit" })]);
    expect(r).toEqual({ config: null, source: { kind: "default" } });
  });
  it("none vs inherit: same at the top, different below a folder with auth", () => {
    expect(resolveAuth(lvl("r", "request", { type: "none" }), []).config).toBeNull();
    expect(resolveAuth(lvl("r", "request", { type: "inherit" }), []).config).toBeNull();
    expect(resolveAuth(lvl("r", "request", { type: "none" }), [bearerFolder]).config).toBeNull();
    expect(resolveAuth(lvl("r", "request", { type: "inherit" }), [bearerFolder]).config?.type).toBe("bearer");
  });
  it("source labels", () => {
    expect(resolvedLabel(resolveAuth(lvl("r", "request", { type: "inherit" }), [bearerFolder]))).toBe("Bearer (from folder ‘api’)");
    expect(resolvedLabel(resolveAuth(lvl("r", "request", { type: "inherit" }), []))).toBe("No auth (nothing set in parents)");
    expect(resolvedLabel(resolveAuth(lvl("r", "request", { type: "none" }), [bearerFolder]))).toBe("No auth (this request)");
    expect(resolvedLabel(resolveAuth(lvl("r", "request", { type: "api_key", api_key_in: "query" }), []))).toBe("API key (query) (this request)");
  });
});

describe("in the tree (request tabs, folder modal)", () => {
  const tree = () => buildTree(
    [
      { id: "api", parent_id: null, name: "api v2", sort_order: 0, auth: { type: "bearer", bearer_token: "{{API_TOKEN}}" } },
      { id: "sub", parent_id: "api", name: "sub", sort_order: 0, auth: { type: "inherit" } },
      { id: "plain", parent_id: null, name: "plain", sort_order: 1 }, // older server: no auth field
    ],
    [
      { id: "r", folder_id: "sub", name: "R", method: "GET", url: "", sort_order: 0, auth: { type: "inherit" } },
      { id: "top", folder_id: null, name: "Top", method: "GET", url: "", sort_order: 0 },
    ],
  );
  it("re-resolves from the tree: a folder two levels up", () => {
    expect(resolveAuthInTree(tree(), "r")?.config?.bearer_token).toBe("{{API_TOKEN}}");
    expect(resolveAuthInTree(tree(), "top")).toEqual({ config: null, source: { kind: "default" } });
    expect(tree().folders.get("plain")?.auth.type).toBe("inherit");
  });
  it("the inherit option names what it resolves to", () => {
    expect(modeOptions(tree(), "r")[0].label).toBe("Inherit from parent — Bearer (from folder ‘api v2’)");
    expect(modeOptions(tree(), "top")[0].label).toBe("Inherit from parent — No auth (nothing set in parents)");
    expect(modeOptions(tree(), "r").map((o) => o.value)).toEqual(["inherit", "none", "bearer", "basic", "api_key"]);
  });
  it("a tab's draft (unsaved) replaces the stored config; the folders still apply", () => {
    expect(effectiveAuthOf(tree(), "r", cfg({ type: "none" })).config).toBeNull();
    expect(effectiveAuthOf(tree(), "r", cfg({ type: "inherit" })).source).toMatchObject({ id: "api" });
    // Not in the tree yet: only its own config counts.
    expect(effectiveAuthOf(tree(), "new", cfg({ type: "bearer", bearer_token: "x" })).config?.bearer_token).toBe("x");
    expect(effectiveAuthOf(tree(), "new", cfg({ type: "inherit" })).source).toEqual({ kind: "default" });
  });
  it("folder modal: the folder's edited config resolves with its own parents", () => {
    expect(resolveAuthInTree(tree(), "sub", cfg({ type: "inherit" }))?.source).toMatchObject({ id: "api" });
    expect(resolveAuthInTree(tree(), "sub", cfg({ type: "basic" }))?.source).toMatchObject({ id: "sub", nodeKind: "folder" });
    expect(modeOptions(tree(), "sub")[0].label).toBe("Inherit from parent — Bearer (from folder ‘api v2’)");
    expect(modeOptions(tree(), "api")[0].label).toBe("Inherit from parent — No auth (nothing set in parents)");
  });
});

describe("editing", () => {
  it("switching mode keeps every other mode's values", () => {
    const a = cfg({ type: "bearer", bearer_token: "{{T}}", basic_username: "u", basic_password: "p", api_key_name: "k", api_key_value: "v", api_key_in: "query" });
    const round = withType(withType(withType(a, "basic"), "api_key"), "bearer");
    expect(round).toEqual(a);
    expect(withType(a, "none")).toEqual({ ...a, type: "none" });
  });
  it("normalizes server input (unknown type -> inherit, placement -> header)", () => {
    expect(normalizeAuth({ type: "oauth2", api_key_in: "cookie" })).toEqual(normalizeAuth());
    expect(normalizeAuth(null).type).toBe("inherit");
  });
  it("sub-tab dots: one rule for Auth and Settings", () => {
    expect(overridesSomething({ authType: "inherit", follow: "inherit" })).toEqual({ auth: false, settings: false });
    expect(overridesSomething({ authType: "none", follow: "inherit" })).toEqual({ auth: true, settings: false });
    expect(overridesSomething({ authType: "inherit", follow: "off" })).toEqual({ auth: false, settings: true });
  });
  it("history rows show only the type's fields", () => {
    expect(authRows(cfg({ type: "bearer", bearer_token: "{{T}}", basic_username: "x" }))).toEqual([{ key: "Token", value: "{{T}}" }]);
    expect(authRows(cfg({ type: "none" }))).toEqual([]);
  });
  it("password masking hides literal text, keeps {{vars}} visible", () => {
    expect(maskRanges("{{PASS}}")).toEqual([]);
    expect(maskRanges("ab{{P}}cd")).toEqual([[0, 2], [7, 9]]);
    expect(maskRanges("hunter2")).toEqual([[0, 7]]);
    expect(maskRanges("")).toEqual([]);
  });
});
