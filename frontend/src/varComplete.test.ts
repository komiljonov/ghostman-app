import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  applyCompletion, completionSpot, CompletionData, EMPTY_LINE, enterAction, envHint, preview, tabAction, varOptions,
} from "./varComplete";
import { displayOf } from "./envStore";
import { varSource } from "./codemirror";
import type { EnvDisplay, VarInfo } from "./vars";

const v = (key: string, value: string, secret = false): VarInfo => ({ key, value, secret, hasValue: true });
const env = (name: string | null, vars: VarInfo[], keys: { key: string; envs: string[]; secret?: boolean }[]): EnvDisplay => ({
  envName: name, vars: new Map(vars.map((x) => [x.key, x])), keys: keys.map((k) => ({ secret: false, ...k })),
});
// Project: dev (BASE_URL, API_TOKEN secret), prod (BASE_URL, PROD_ONLY), staging (PROD_ONLY, STAGE), ...
const KEYS = [
  { key: "BASE_URL", envs: ["dev", "prod"] },
  { key: "API_TOKEN", envs: ["dev"], secret: true },
  { key: "PROD_ONLY", envs: ["prod", "staging"] },
  { key: "STAGE", envs: ["staging"] },
  { key: "base_url_alt", envs: ["prod", "staging", "qa", "ci"] },
];
const dev = (): CompletionData => {
  const e = env("dev", [v("BASE_URL", "https://dev.example.com/api/v1/something/long"), v("API_TOKEN", "s3cret", true)], KEYS);
  return { env: e, keys: e.keys! };
};
const spotOf = (text: string) => {
  const cursor = text.indexOf("|");
  const t = text.replace("|", "");
  return completionSpot(t.slice(0, cursor), t.slice(cursor), cursor);
};

describe("trigger context", () => {
  it("opens right after {{ and inside an unclosed {{prefix", () => {
    expect(spotOf("https://{{|")).toEqual({ from: 10, to: 10, prefix: "", closed: false });
    expect(spotOf("x {{pa|")).toEqual({ from: 4, to: 6, prefix: "pa", closed: false });
  });
  it("never outside a {{ context", () => {
    for (const t of ["https://api|", "{ |", "{{done}} more|", "a{|", "{{a}}|"]) expect(spotOf(t)).toBeNull();
  });
  it("inside an existing {{...}}: replaces the rest of the key, keeps the braces", () => {
    expect(spotOf("{{|BASE_URL}}/x")).toEqual({ from: 2, to: 10, prefix: "", closed: true });
    expect(spotOf("{{BA|SE_URL}}")).toEqual({ from: 2, to: 10, prefix: "BA", closed: true });
    // auto-closed braces (the raw body's closeBrackets): "{{|}}"
    expect(spotOf("{{|}}")).toEqual({ from: 2, to: 2, prefix: "", closed: true });
  });
  it("accept inserts the key + braces, cursor after them; no duplicate }}", () => {
    const open = spotOf("u/{{pr|")!;
    expect(applyCompletion(open, "PROD_ONLY")).toEqual({ insert: "PROD_ONLY}}", cursor: 15 });
    const closed = spotOf("{{BA|SE_URL}}/x")!;
    expect(applyCompletion(closed, "PROD_ONLY")).toEqual({ insert: "PROD_ONLY", cursor: 13 });
  });
});

describe("options", () => {
  it("groups: available (active env) always above unavailable", () => {
    const { options } = varOptions(dev(), "");
    expect(options.map((o) => `${o.group[0]}:${o.key}`)).toEqual([
      "a:API_TOKEN", "a:BASE_URL", "u:base_url_alt", "u:PROD_ONLY", "u:STAGE",
    ]);
  });
  it("prefix before substring within a group; group order beats match quality", () => {
    // "url" is only a SUBSTRING of the available BASE_URL, a PREFIX of the unavailable
    // URL_PROD: BASE_URL still comes first.
    const d = dev();
    d.keys.push({ key: "URL_PROD", envs: ["prod"], secret: false });
    expect(varOptions(d, "url").options.map((o) => o.key)).toEqual(["BASE_URL", "URL_PROD", "base_url_alt"]);
  });
  it("case-insensitive filter, real case kept", () => {
    expect(varOptions(dev(), "pr").options.map((o) => o.key)).toEqual(["PROD_ONLY"]);
    expect(varOptions(dev(), "api").options[0].key).toBe("API_TOKEN");
    expect(varOptions(dev(), "zzz").options).toEqual([]);
  });
  it("dedupes across envs; available wins", () => {
    const base = varOptions(dev(), "BASE_URL").options.filter((o) => o.key === "BASE_URL");
    expect(base).toHaveLength(1);
    expect(base[0].group).toBe("available");
  });
  it("previews: truncated value; secrets have none", () => {
    const [tok, base] = varOptions(dev(), "").options;
    expect(tok).toMatchObject({ key: "API_TOKEN", secret: true, detail: "" });
    expect(base.detail).toBe(preview("https://dev.example.com/api/v1/something/long"));
    expect(base.detail.length).toBe(30);
    expect(base.detail.endsWith("…")).toBe(true);
  });
  it("env hints: 1, 2, 3+ envs; no values for unavailable keys", () => {
    expect(envHint(["prod"])).toBe("in prod");
    expect(envHint(["prod", "staging"])).toBe("in prod, staging");
    expect(envHint(["prod", "staging", "qa", "ci"])).toBe("in prod, staging +2");
    const byKey = Object.fromEntries(varOptions(dev(), "").options.map((o) => [o.key, o.detail]));
    expect(byKey.PROD_ONLY).toBe("in prod, staging");
    expect(byKey.base_url_alt).toBe("in prod, staging +2");
  });
  it("no active env: everything unavailable with hints", () => {
    const e = env(null, [], KEYS);
    const { options, empty } = varOptions({ env: e, keys: e.keys! }, "");
    expect(empty).toBe(false);
    expect(options.every((o) => o.group === "unavailable")).toBe(true);
    expect(options.find((o) => o.key === "BASE_URL")?.detail).toBe("in dev, prod");
  });
  it("a project without variables: the empty line", () => {
    expect(varOptions({ env: env(null, [], []), keys: [] }, "")).toEqual({ options: [], empty: true });
  });
});

describe("keys", () => {
  it("Enter/Tab accept while completing, are swallowed while pending, else default (Send / focus)", () => {
    expect(enterAction("active")).toBe("accept");
    expect(enterAction("pending")).toBe("swallow");
    expect(enterAction(null)).toBe("default");
    expect(tabAction("active")).toBe("accept");
    expect(tabAction(null)).toBe("default");
  });
});

describe("CodeMirror source (the shared extension)", () => {
  const run = (doc: string, e: EnvDisplay, explicit = false) => {
    const pos = doc.indexOf("|");
    const state = EditorState.create({ doc: doc.replace("|", "") });
    return varSource(() => e)(new CompletionContext(state, pos, explicit));
  };
  const d = dev().env;
  it("answers only in a {{ context, with the from/to range and our order", () => {
    expect(run("https://api|", d)).toBeNull();
    expect(run("https://api|", d, true)).toBeNull(); // Ctrl+Space outside {{: nothing
    const r = run("{{BASE_URL}}/x?k={{pr|", d)!;
    expect(r.from).toBe(19);
    expect(r.to).toBe(21);
    expect(r.filter).toBe(false);
    expect(r.options.map((o) => o.label)).toEqual(["PROD_ONLY"]);
    expect(r.options[0].section).toMatchObject({ rank: 1 });
    const all = run("{{|", d)!;
    expect(all.options.map((o) => [o.label, (o.section as { rank: number }).rank])).toEqual([
      ["API_TOKEN", 0], ["BASE_URL", 0], ["base_url_alt", 1], ["PROD_ONLY", 1], ["STAGE", 1],
    ]);
  });
  it("multi-line body: the context is the cursor's line", () => {
    expect(run('{\n  "t": "{{api|"\n}', d)!.options[0].label).toBe("API_TOKEN");
  });
  it("no matches closes; an empty project shows the disabled line", () => {
    expect(run("{{zzz|", d)).toBeNull();
    const empty = run("{{|", env(null, [], []))!;
    expect(empty.options.map((o) => o.label)).toEqual([EMPTY_LINE]);
  });
});

describe("store snapshot", () => {
  const ctx = (active: string) => ({
    environments: [], active_id: active, active_name: active ? "dev" : "",
    variables: active ? [{ id: "1", key: "BASE_URL", type: "regular", value: "https://dev", has_value: true, sort_order: 0 }] : [],
    keys: [
      { key: "BASE_URL", envs: ["dev", "prod"], env_ids: ["d", "p"], secret: false },
      { key: "PROD_ONLY", envs: ["prod"], env_ids: ["p"], secret: false },
    ],
  });
  it("carries every env's keys; values only from the active env", () => {
    const withEnv = displayOf(ctx("d") as never);
    expect(withEnv.vars.get("BASE_URL")?.value).toBe("https://dev");
    expect(withEnv.keys?.map((k) => k.key)).toEqual(["BASE_URL", "PROD_ONLY"]);
    expect(JSON.stringify(withEnv.keys)).not.toContain("value");
    const none = displayOf(ctx("") as never);
    expect(none.envName).toBeNull();
    expect(none.keys).toHaveLength(2);
    expect(displayOf(undefined).keys).toEqual([]);
  });
});
