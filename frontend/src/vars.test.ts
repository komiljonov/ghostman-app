import { describe, expect, it } from "vitest";
import { classify, EnvDisplay, findTokens, MASK, NO_ENV, tooltipModel, VarInfo } from "./vars";

const env = (name: string | null, vars: VarInfo[]): EnvDisplay => ({ envName: name, vars: new Map(vars.map((v) => [v.key, v])) });
const dev = env("dev", [
  { key: "BASE_URL", value: "https://dev.example", secret: false, hasValue: true },
  { key: "EMPTY", value: "", secret: false, hasValue: false },
  { key: "API_TOKEN", value: "tok-123", secret: true, hasValue: true },
  { key: "UNSET", value: "", secret: true, hasValue: false },
  { key: " a ", value: "spaced", secret: false, hasValue: true },
]);

// Same token cases as internal/engine/resolve_test.go.
describe("findTokens (mirrors Go FindTokens)", () => {
  const keys = (s: string) => findTokens(s).map((t) => t.key);
  it.each([
    ["https://example.com", []],
    ["https://{{host}}/v1", ["host"]],
    ["{{x}}-{{x}}-{{host}}", ["x", "x", "host"]],
    ["{{ a }}|{{a}}", [" a ", "a"]],
    ["{{}}", []],
    ["{{host", []],
    ["{host}", []],
    ["{{a{b}}", []],
    ["{{{x}}", ["x"]],
    ["{{x}}}", ["x"]],
    ["{{x}}{{x}}", ["x", "x"]],
  ])("%s", (input, want) => {
    expect(keys(input)).toEqual(want);
  });

  it("reports offsets of the whole token", () => {
    const s = "x{{a}}y{{bb}}";
    expect(findTokens(s)).toEqual([{ key: "a", from: 1, to: 6 }, { key: "bb", from: 7, to: 13 }]);
  });
});

describe("classify", () => {
  const states = (s: string, e: EnvDisplay) => classify(s, e).map((t) => `${t.key}:${t.resolved ? "ok" : "missing"}`);

  it("marks defined keys resolved and undefined ones unresolved (case-sensitive)", () => {
    expect(states("{{BASE_URL}}/{{base_url}}/{{nope}}", dev)).toEqual(["BASE_URL:ok", "base_url:missing", "nope:missing"]);
  });
  it("a regular variable without a value is still defined (resolves to empty)", () => {
    expect(states("{{EMPTY}}", dev)).toEqual(["EMPTY:ok"]);
  });
  it("a secret resolves only with a value on this machine", () => {
    expect(states("{{API_TOKEN}} {{UNSET}}", dev)).toEqual(["API_TOKEN:ok", "UNSET:missing"]);
  });
  it("keys are not trimmed", () => {
    expect(states("{{ a }} {{a}}", dev)).toEqual([" a :ok", "a:missing"]);
  });
  it("with no environment everything is unresolved", () => {
    expect(states("{{BASE_URL}} {{API_TOKEN}}", NO_ENV)).toEqual(["BASE_URL:missing", "API_TOKEN:missing"]);
  });
});

describe("tooltip model", () => {
  it("shows regular values in clear text with the env name", () => {
    expect(tooltipModel("BASE_URL", dev)).toMatchObject({ resolved: true, secret: false, display: "https://dev.example", envName: "dev" });
  });
  it("masks secrets by default; the real value is only for click-to-reveal", () => {
    const m = tooltipModel("API_TOKEN", dev);
    expect(m.display).toBe(MASK);
    expect(m.display).not.toContain("tok-123");
    expect(m.revealValue).toBe("tok-123");
    expect(m.tag).toBe("local");
    expect(m.envName).toBe("dev");
  });
  it("a secret without a local value says so and has nothing to reveal", () => {
    const m = tooltipModel("UNSET", dev);
    expect(m).toMatchObject({ resolved: false, display: "not set on this machine" });
    expect(m.revealValue).toBeUndefined();
  });
  it("explains undefined keys and the no-environment case", () => {
    expect(tooltipModel("nope", dev).display).toBe("unresolved — not defined in dev");
    expect(tooltipModel("BASE_URL", NO_ENV).display).toBe("unresolved — no environment selected");
  });
});
