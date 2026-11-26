import { describe, expect, it } from "vitest";
import { pathVarKeys, pathVarSpans, reconcilePathParams } from "./urlParams";
import { previewResolved, type EnvDisplay } from "./vars";

// The derivation table — internal/engine/pathvars_test.go has the same cases.
describe("path variable derivation", () => {
  const cases: [string, string[]][] = [
    ["https://api.test/users/:id", ["id"]],
    ["https://api.test/users/:id/posts/:post_id", ["id", "post_id"]],
    ["{{BASE_URL}}/users/:id?x=:q", ["id"]], // the query is not the path
    ["https://api.test:8080/:_a1", ["_a1"]], // a port is not a variable
    ["https://api.test/:id/:id", ["id"]], // once
    ["https://api.test/:", []],
    ["https://api.test/:1d", []],
    ["https://api.test/:id.json", []],
    ["https://api.test/x:id", []],
    ["https://api.test/:id-x", []],
    ["https://api.test/{{:id}}", []],
    [":id", ["id"]],
    ["", []],
  ];
  it.each(cases)("%s", (url, want) => expect(pathVarKeys(url)).toEqual(want));

  it("spans: offsets of each :key segment in the path (for the URL bar highlight)", () => {
    const url = "{{B}}/u/:id/x/:id?q=:id";
    expect(pathVarSpans(url)).toEqual([{ key: "id", from: 8, to: 11 }, { key: "id", from: 14, to: 17 }]);
    expect(pathVarSpans(":a/:b")).toEqual([{ key: "a", from: 0, to: 2 }, { key: "b", from: 3, to: 5 }]);
  });
});

describe("path rows follow the URL", () => {
  const rows = [{ key: "id", value: "42" }, { key: "post", value: "7" }];

  it("values persist by key; rows whose key left the URL are dropped; new keys append empty", () => {
    expect(reconcilePathParams(rows, "/u/:post/:id/:extra")).toEqual([
      { key: "id", value: "42" }, { key: "post", value: "7" }, { key: "extra", value: "" },
    ]);
    expect(reconcilePathParams(rows, "/u/:post")).toEqual([{ key: "post", value: "7" }]);
    expect(reconcilePathParams(rows, "/u")).toEqual([]);
  });

  it("nothing changed → the same array (no needless save)", () => {
    expect(reconcilePathParams(rows, "/u/:id/:post?x=1")).toBe(rows);
    expect(reconcilePathParams(rows, "/u/:post/:id")).toBe(rows); // order is the rows', not re-sorted
  });

  it("typing a key: each keystroke reconciles; a key re-added later starts empty", () => {
    let r = reconcilePathParams([], "/u/:i");
    expect(r).toEqual([{ key: "i", value: "" }]);
    r = reconcilePathParams([{ key: "i", value: "x" }], "/u/:id");
    expect(r).toEqual([{ key: "id", value: "" }]);
  });

  it("duplicate stored rows collapse to the first", () => {
    expect(reconcilePathParams([{ key: "id", value: "1" }, { key: "id", value: "2" }], "/:id")).toEqual([{ key: "id", value: "1" }]);
  });
});

describe("resolved preview (path variable hover)", () => {
  const env: EnvDisplay = {
    envName: "dev",
    vars: new Map([
      ["USER", { key: "USER", value: "u-1", secret: false, hasValue: true }],
      ["TOKEN", { key: "TOKEN", value: "s", secret: true, hasValue: true }],
    ]),
  };
  it("regular values in, secrets masked, generated as <$name>, unknown kept", () => {
    expect(previewResolved("{{USER}}-{{TOKEN}}-{{$uuid}}-{{nope}}-{{$nope}}", env)).toBe("u-1-••••••-<$uuid>-{{nope}}-{{$nope}}");
    expect(previewResolved("{{USER}}", { envName: null, vars: new Map() })).toBe("{{USER}}");
  });
});
