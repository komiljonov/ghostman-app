import { describe, expect, it } from "vitest";
import { newRow, Row } from "./rows";
import { adoptUrlQuery, applyUrlInput, reconcileParams, sameMeaning, serializeUrl, splitUrl } from "./urlParams";

const on = (key: string, value: string): Row => newRow({ key, value });
const off = (key: string, value: string): Row => newRow({ key, value, enabled: false });
const pairs = (text: string) => splitUrl(text).pairs.map((p) => `${p.key}=${p.value}`);

describe("parsing the URL input", () => {
  it("splits base / query on the first ?, parts on & then the first =", () => {
    expect(splitUrl("https://x.io/a?b=1&c=2")).toEqual({
      base: "https://x.io/a", pairs: [{ key: "b", value: "1" }, { key: "c", value: "2" }],
    });
    expect(splitUrl("https://x.io/a")).toEqual({ base: "https://x.io/a", pairs: [] });
    expect(splitUrl("x?")).toEqual({ base: "x", pairs: [] });
  });
  it.each([
    ["?a=1&a=2", ["a=1", "a=2"]], // duplicates survive, in order
    ["?flag", ["flag="]], // no "=" → empty value
    ["?a=b=c", ["a=b=c"]], // only the first "=" splits
    ["?a=1&", ["a=1"]], // trailing & ignored
    ["?a=1&&b=2", ["a=1", "b=2"]], // empty parts ignored
    ["?=v&b=2", ["b=2"]], // a keyless pair is not a row
    ["?q=a%20b&r=x+y", ["q=a%20b", "r=x+y"]], // verbatim: no decoding
    ["?{{k}}={{v}}&t={{BASE}}/p?x", ["{{k}}={{v}}", "t={{BASE}}/p?x"]], // {{vars}} and later ? pass through
  ])("%s → %j", (query, expected) => {
    expect(pairs(`{{BASE_URL}}/get${query}`)).toEqual(expected);
  });
});

describe("serializing rows into the URL", () => {
  it("base + ? + enabled keyed rows as k=v joined by &", () => {
    expect(serializeUrl("x", [on("a", "1"), off("b", "2"), on("c", "")])).toBe("x?a=1&c=");
  });
  it("no ? without enabled params; keyless rows excluded", () => {
    expect(serializeUrl("x", [])).toBe("x");
    expect(serializeUrl("x", [off("a", "1"), on("", "v"), on("  ", "w")])).toBe("x");
  });
  it("empty values always serialize as k= (also for a parsed bare ?flag)", () => {
    const { url, rows } = applyUrlInput("x?flag", []);
    expect(serializeUrl(url, rows)).toBe("x?flag=");
  });
  it("round-trips duplicates, a=b=c and {{vars}} verbatim", () => {
    for (const text of ["x?a=1&a=2", "x?a=b=c", "{{B}}/p?{{q}}=v&t={{T}}", "x?q=a%20b"]) {
      const { url, rows } = applyUrlInput(text, []);
      expect(serializeUrl(url, rows)).toBe(text);
    }
  });
});

describe("URL edit → params (reconcile)", () => {
  it("creates rows in order from scratch (the verify case ?x=1&x=2&{{q}}=v)", () => {
    const { url, rows } = applyUrlInput("{{BASE_URL}}/get?x=1&x=2&{{q}}=v", []);
    expect(url).toBe("{{BASE_URL}}/get");
    expect(rows).toEqual([on("x", "1"), on("x", "2"), on("{{q}}", "v")]);
  });
  it("updates matched rows in place (same position, other fields kept)", () => {
    const rows = [on("a", "1"), on("b", "2")];
    const next = reconcileParams(rows, [{ key: "a", value: "9" }, { key: "b", value: "2" }]);
    expect(next).toEqual([on("a", "9"), on("b", "2")]);
    expect(next[1]).toBe(rows[1]); // untouched row is the same object
  });
  it("appends extra pairs at the end and deletes rows whose pair is gone", () => {
    expect(reconcileParams([on("a", "1")], [{ key: "a", value: "1" }, { key: "n", value: "" }]))
      .toEqual([on("a", "1"), on("n", "")]);
    expect(reconcileParams([on("a", "1"), on("b", "2"), on("c", "3")], [{ key: "a", value: "1" }]))
      .toEqual([on("a", "1")]);
  });
  it("leaves disabled and keyless rows untouched, at their positions", () => {
    const rows = [off("d", "0"), on("a", "1"), on("", "typing"), off("e", "5"), on("b", "2")];
    const next = reconcileParams(rows, [{ key: "a", value: "7" }]);
    expect(next).toEqual([off("d", "0"), on("a", "7"), on("", "typing"), off("e", "5")]);
    const grown = reconcileParams(rows, [{ key: "a", value: "1" }, { key: "b", value: "2" }, { key: "z", value: "9" }]);
    expect(grown).toEqual([...rows, on("z", "9")]);
  });
  it("a base-url-only edit leaves the rows untouched (same array)", () => {
    const rows = [on("a", "1"), off("b", "2"), on("c", "3")];
    const before = serializeUrl("http://old", rows);
    const edited = before.replace("http://old", "https://new/v2");
    const next = applyUrlInput(edited, rows);
    expect(next.url).toBe("https://new/v2");
    expect(next.rows).toBe(rows);
  });
  it("clearing the query deletes the URL rows but keeps disabled ones", () => {
    expect(applyUrlInput("x", [on("a", "1"), off("b", "2")]).rows).toEqual([off("b", "2")]);
  });
});

describe("params edit → URL, and the loop guard", () => {
  it("disable leaves the URL, re-enable returns at its position", () => {
    const rows = [on("x", "1"), on("x", "2"), on("{{q}}", "v")];
    const disabled = rows.map((r, i) => (i === 1 ? { ...r, enabled: false } : r));
    expect(serializeUrl("b", disabled)).toBe("b?x=1&{{q}}=v");
    expect(serializeUrl("b", rows)).toBe("b?x=1&x=2&{{q}}=v");
  });
  it("re-deriving from the serialized URL is a no-op (a sync write cannot echo back)", () => {
    const rows = [off("d", "0"), on("a", "1"), on("", "k"), on("b", "")];
    const text = serializeUrl("{{B}}/p", rows);
    const back = applyUrlInput(text, rows);
    expect(back.url).toBe("{{B}}/p");
    expect(back.rows).toBe(rows);
  });
  it("the URL input is not rewritten while it means the same thing (typing in progress)", () => {
    expect(sameMeaning("x?a=1&", "x?a=1")).toBe(true);
    expect(sameMeaning("x?a", "x?a=")).toBe(true);
    expect(sameMeaning("x?", "x")).toBe(true);
    expect(sameMeaning("x?a=1&=5", "x?a=1")).toBe(true);
    expect(sameMeaning("x?a=1", "x?a=2")).toBe(false);
    expect(sameMeaning("x?a=1", "y?a=1")).toBe(false);
    expect(sameMeaning("x?a=1&b=2", "x?b=2&a=1")).toBe(false); // order matters
  });
});

describe("legacy urls with a query inside", () => {
  it("move their pairs into the rows, first (where they were sent)", () => {
    expect(adoptUrlQuery("{{B}}/a?n=3&m=", [on("p", "1"), off("q", "2")])).toEqual({
      url: "{{B}}/a", rows: [on("n", "3"), on("m", ""), on("p", "1"), off("q", "2")],
    });
    const rows = [on("p", "1")];
    expect(adoptUrlQuery("{{B}}/a", rows)).toEqual({ url: "{{B}}/a", rows });
  });
});
