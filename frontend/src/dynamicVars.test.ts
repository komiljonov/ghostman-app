import { describe, expect, it } from "vitest";
import { GENERATED, generatedInfo, unresolvedBanner } from "./dynamicVars";
import { withTimeClaims } from "./jwtAuth";
import { generatedOptions, groupLabel, groupRank } from "./varComplete";
import { classify, segments, tooltipActions, tooltipModel, type EnvDisplay } from "./vars";

const env: EnvDisplay = {
  envId: "e1",
  envName: "dev",
  vars: new Map([["$uuid", { key: "$uuid", value: "from-env", secret: false, hasValue: true }]]),
};

// The keys Go knows (internal/engine/dynamic.go; dynamic_test.go's table).
describe("generated variables", () => {
  it("the list mirrors Go's", () => {
    expect(GENERATED.map((g) => g.key)).toEqual(["$uuid", "$timestamp", "$isoTimestamp", "$date", "$randomInt", "$randomHex", "$now", "$now+3600"]);
  });

  it("example values have the formats Go generates", () => {
    expect(generatedInfo("$uuid")!.example).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(generatedInfo("$timestamp")!.example).toMatch(/^\d{10}$/);
    expect(generatedInfo("$isoTimestamp")!.example).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(generatedInfo("$date")!.example).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(generatedInfo("$randomInt")!.example).toMatch(/^\d{1,6}$/);
    expect(generatedInfo("$randomHex")!.example).toMatch(/^[0-9a-f]{16}$/);
    const now = Number(generatedInfo("$now")!.example);
    expect(Number(generatedInfo("$now+60")!.example) - now).toBeGreaterThanOrEqual(59);
    expect(generatedInfo("$now-1")!.description).toBe("unix time 1 second ago");
  });

  it("exact keys only, like Go", () => {
    for (const k of ["$UUID", "$now+1.5", "$now +1", "$ now", "$", "$guid", "$randomint"]) expect(generatedInfo(k)).toBeUndefined();
  });

  it("highlight: known → dynamic (never the env's value); unknown $name → unresolved", () => {
    const t = classify("{{$uuid}} {{$nope}} {{$now-30}}", env);
    expect(t.map((x) => `${x.key}:${x.dynamic}:${x.resolved}`)).toEqual(["$uuid:true:true", "$nope:false:false", "$now-30:true:true"]);
    expect(segments("a{{$uuid}}", env).map((s) => s.kind)).toEqual(["plain", "dynamic"]);
  });

  it("hover: description + example, no env, no edit actions", () => {
    const m = tooltipModel("$uuid", env);
    expect(m).toMatchObject({ resolved: true, dynamic: true, display: "a random UUID (v4)", envName: null });
    expect(m.example).toBeTruthy();
    expect(tooltipModel("$nope", env)).toMatchObject({ resolved: false, display: "unknown generated variable — sent literally" });
    expect(tooltipActions("$nope", env)).toEqual({ edit: false, editAfterReveal: false }); // no "Create in dev"
  });

  it("the JWT payload's time claims keep their own wording (unchanged)", () => {
    const m = tooltipModel("$now+60", withTimeClaims(env));
    expect(m).toMatchObject({ tag: "time claim", dynamic: true });
    expect(m.display).toContain("a number in the signed token");
  });
});

describe("the {{ popup's Generated group", () => {
  it("always last, with descriptions; matched with or without $", () => {
    expect(groupRank("generated")).toBeGreaterThan(groupRank("unavailable"));
    expect(groupLabel("generated", "dev")).toBe("Generated");
    expect(generatedOptions("").map((o) => o.key)).toEqual(GENERATED.map((g) => g.key));
    expect(generatedOptions("uu")).toEqual([{ key: "$uuid", group: "generated", secret: false, detail: "a random UUID (v4)" }]);
    expect(generatedOptions("$ran").map((o) => o.key)).toEqual(["$randomInt", "$randomHex"]);
    expect(generatedOptions("stamp").map((o) => o.key)).toEqual(["$timestamp", "$isoTimestamp"]); // substring
    expect(generatedOptions("TOKEN")).toEqual([]);
  });
});

describe("the response banner", () => {
  it("names each kind", () => {
    expect(unresolvedBanner(["API", "$nope", "$x"])).toBe(
      "Unresolved variables: {{API}} · Unknown generated variables: {{$nope}}, {{$x}}");
    expect(unresolvedBanner(["API"])).toBe("Unresolved variables: {{API}}");
  });
});
