import { describe, expect, it } from "vitest";
import { AuthConfig, authRows, effectiveAuthOf, modeOptions, normalizeAuth, resolvedLabel } from "./auth";
import { jwtNamePlaceholder, jwtPrefixDisabled, jwtSentAs, maskedSecret, previewView, timeClaimText, withTimeClaims } from "./jwtAuth";
import { classify, NO_ENV, tooltipActions, tooltipModel } from "./vars";
import { buildTree } from "./tree";

const cfg = (over: Partial<AuthConfig>): AuthConfig => ({ ...normalizeAuth(), ...over });

describe("jwt config", () => {
  it("normalizes with defaults; unknown algorithm / placement fall back", () => {
    const n = normalizeAuth({ type: "jwt" });
    expect(n).toMatchObject({ type: "jwt", jwt_algorithm: "HS256", jwt_add_to: "header", jwt_secret_base64: false, jwt_prefix: "" });
    expect(normalizeAuth({ type: "jwt", jwt_algorithm: "RS256", jwt_add_to: "cookie" })).toMatchObject({ jwt_algorithm: "HS256", jwt_add_to: "header" });
    expect(normalizeAuth({ type: "jwt", jwt_algorithm: "HS512", jwt_add_to: "query", jwt_secret_base64: true }))
      .toMatchObject({ jwt_algorithm: "HS512", jwt_add_to: "query", jwt_secret_base64: true });
  });
  it("placeholders, prefix state and the 'sent as' line follow Add to", () => {
    expect(jwtNamePlaceholder("header")).toBe("Authorization");
    expect(jwtNamePlaceholder("query")).toBe("token");
    expect(jwtPrefixDisabled("query")).toBe(true);
    expect(jwtPrefixDisabled("header")).toBe(false);
    expect(jwtSentAs(cfg({ jwt_add_to: "header" }))).toBe("Authorization: Bearer <token>");
    expect(jwtSentAs(cfg({ jwt_add_to: "header", jwt_name: "X-Token", jwt_prefix: "JWT " }))).toBe("X-Token: JWT <token>");
    expect(jwtSentAs(cfg({ jwt_add_to: "query", jwt_prefix: "Bearer " }))).toBe("?token=<token>");
    expect(jwtSentAs(cfg({ jwt_add_to: "query", jwt_name: "access_token" }))).toBe("?access_token=<token>");
  });
  it("history rows: the template, with defaults spelled out", () => {
    expect(authRows(cfg({ type: "jwt", jwt_secret: "{{S}}", jwt_secret_base64: true, jwt_payload: "{}", jwt_add_to: "query" }))).toEqual([
      { key: "Algorithm", value: "HS256" }, { key: "Secret", value: "{{S}} (Base64)" }, { key: "Payload", value: "{}" },
      { key: "Add to", value: "Query params" }, { key: "Name", value: "token" },
    ]);
  });
});

describe("jwt in the cascade", () => {
  const tree = () => buildTree(
    [
      { id: "api", parent_id: null, name: "api", sort_order: 0, auth: { type: "jwt", jwt_secret: "{{JWT_SECRET}}", jwt_payload: "{}" } },
      { id: "sub", parent_id: "api", name: "sub", sort_order: 0, auth: { type: "inherit" } },
      { id: "nope", parent_id: "api", name: "nope", sort_order: 1, auth: { type: "none" } },
    ],
    [
      { id: "r", folder_id: "sub", name: "R", method: "GET", url: "", sort_order: 0, auth: { type: "inherit" } },
      { id: "q", folder_id: "nope", name: "Q", method: "GET", url: "", sort_order: 0, auth: { type: "inherit" } },
    ],
  );
  it("a request inherits a folder's JWT, with the full config", () => {
    const r = effectiveAuthOf(tree(), "r", normalizeAuth({ type: "inherit" }));
    expect(r.config?.type).toBe("jwt");
    expect(r.config?.jwt_secret).toBe("{{JWT_SECRET}}");
    expect(resolvedLabel(r)).toBe("JWT (from folder ‘api’)");
    expect(modeOptions(tree(), "r")[0].label).toBe("Inherit from parent — JWT (from folder ‘api’)");
    expect(modeOptions(tree(), "r").map((o) => o.value)).toContain("jwt");
  });
  it("none below stops it; the request's own JWT (draft) wins", () => {
    expect(effectiveAuthOf(tree(), "q", normalizeAuth({ type: "inherit" })).config).toBeNull();
    const own = effectiveAuthOf(tree(), "r", normalizeAuth({ type: "jwt", jwt_secret: "own" }));
    expect(own.config?.jwt_secret).toBe("own");
    expect(resolvedLabel(own)).toBe("JWT (this request)");
    // Not in the tree yet: its own config alone.
    expect(effectiveAuthOf(tree(), "new", normalizeAuth({ type: "jwt" })).config?.type).toBe("jwt");
  });
});

describe("the preview", () => {
  const data = { header: '{\n  "alg": "HS256"\n}', payload: '{\n  "exp": 1700003600\n}', token_head: "eyJhbGci", token_tail: "abcd1234", unresolved: [], environment: "dev" };
  it("shows the resolved claims and a shortened token, never a secret value", () => {
    const v = previewView({ data }, { jwt_secret: "{{JWT_SECRET}}", jwt_secret_base64: false });
    expect(v).toEqual({ kind: "ok", header: data.header, payload: data.payload, token: "eyJhbGci…abcd1234", secret: "{{JWT_SECRET}}", notes: [] });
  });
  it("masks literal secret text, keeps {{vars}} visible", () => {
    expect(maskedSecret("hunter2", false)).toBe("••••••");
    expect(maskedSecret("pre-{{K}}-post", true)).toBe("••••••{{K}}•••••• (Base64)");
    expect(maskedSecret("", false)).toBe("(empty)");
    const v = previewView({ data }, { jwt_secret: "literal-key", jwt_secret_base64: false });
    expect(JSON.stringify(v)).not.toContain("literal-key");
  });
  it("notes unresolved payload vars and a missing environment; errors pass through", () => {
    const v = previewView({ data: { ...data, unresolved: ["user_id", "x"] } }, { jwt_secret: "{{S}}", jwt_secret_base64: false });
    expect(v.kind === "ok" && v.notes).toEqual(["{{user_id}}, {{x}} have no value in dev — signed as literal text."]);
    const noEnv = previewView({ data: { ...data, environment: "", unresolved: ["a"] } }, { jwt_secret: "{{S}}", jwt_secret_base64: false });
    expect(noEnv.kind === "ok" && noEnv.notes).toEqual(["No active environment — {{variables}} stay literal.", "{{a}} has no value — signed as literal text."]);
    expect(previewView({ error: { message: "JWT not signed: the secret uses {{JWT_SECRET}}, …" } }, { jwt_secret: "", jwt_secret_base64: false }))
      .toEqual({ kind: "error", message: "JWT not signed: the secret uses {{JWT_SECRET}}, …" });
  });
});

describe("time claims in the payload editor", () => {
  it("the exact forms only (engine.DynamicClaim)", () => {
    expect(timeClaimText("$now")).toContain("unix time now");
    expect(timeClaimText("$now+3600")).toContain("+ 3600 s");
    expect(timeClaimText("$now-30")).toContain("− 30 s");
    for (const k of ["$now+", "$now+1.5", " $now", "$NOW", "now", "$now*2"]) expect(timeClaimText(k)).toBeUndefined();
  });
  it("highlight as resolved, hover explains, never editable — other vars unchanged", () => {
    const env = { envId: "e", envName: "dev", vars: new Map([["user_id", { id: "v", key: "user_id", value: "u-1", secret: false, hasValue: true }]]) };
    const w = withTimeClaims(env);
    expect(classify('{"iat":"{{$now}}","sub":"{{user_id}}","x":"{{nope}}"}', w).map((t) => t.resolved)).toEqual([true, true, false]);
    expect(tooltipModel("$now+60", w)).toMatchObject({ resolved: true, tag: "time claim" });
    expect(tooltipActions("$now", w)).toEqual({ edit: false, editAfterReveal: false });
    expect(tooltipActions("user_id", w).edit).toBe(true);
    // Without an environment too; and the plain env is not touched.
    expect(tooltipModel("$now", withTimeClaims(NO_ENV)).resolved).toBe(true);
    expect(classify("{{$now}}", env)[0].resolved).toBe(false);
  });
});
