import { describe, expect, it } from "vitest";
import { parseBulk, parseLine, serializeRows, textMeansRows } from "./bulkEdit";
import type { Row } from "./rows";
import { applyUrlInput, serializeUrl } from "./urlParams";

const r = (key: string, value: string, enabled = true): Row => ({ key, value, enabled });

describe("bulk edit grammar", () => {
  const cases: [string, string, Row | null][] = [
    ["plain", "a:1", r("a", "1")],
    ["JSON in the value (retailcrm)", 'order:{"a":1,"b":{"c":2}}', r("order", '{"a":1,"b":{"c":2}}')],
    ["multiple colons: first one splits", "time:12:30:00", r("time", "12:30:00")],
    ["URL value", "callback:https://x.io:8443/a?b=c", r("callback", "https://x.io:8443/a?b=c")],
    ["disabled", "//X-Debug:1", r("X-Debug", "1", false)],
    ["disabled, indented", "   //X-Debug:1", r("X-Debug", "1", false)],
    ["empty value", "flag:", r("flag", "")],
    ["no colon -> empty value", "flag", r("flag", "")],
    ["key trimmed, value verbatim (space after colon kept)", "  key  : v ", r("key", " v ")],
    ["CRLF", "a:1\r", r("a", "1")],
    ["blank", "   ", null],
    ["empty", "", null],
    ["'//' alone", "//", null],
    ["keyless value kept (a row being typed)", ":v", r("", "v")],
  ];
  for (const [name, line, want] of cases) {
    it(name, () => expect(parseLine(line)).toEqual(want));
  }

  it("parses in order, keeping duplicates, skipping blank lines", () => {
    expect(parseBulk("b:2\n\na:1\n//a:old\nb:3\n")).toEqual([r("b", "2"), r("a", "1"), r("a", "old", false), r("b", "3")]);
  });

  it("serializes disabled rows with //, in order; the empty editing row is omitted", () => {
    expect(serializeRows([r("a", "1"), r("X-Debug", "1", false), r("", "")])).toBe("a:1\n//X-Debug:1");
    expect(serializeRows([])).toBe("");
  });
});

describe("round trip: table -> bulk -> table is identical", () => {
  const tables: Row[][] = [
    [],
    [r("order", '{"customer":{"id":5},"items":[1,2]}'), r("site", "shop")],
    [r("a", "1"), r("a", "2"), r("a", "1")], // duplicates and order
    [r("X-Debug", "1", false), r("Accept", "*/*"), r("Authorization", "Bearer {{API_TOKEN}}")],
    [r("empty", ""), r("disabled-empty", "", false), r("", "keyless")],
    [r("t", "12:30:00"), r("sp", " leading and trailing ")],
  ];
  for (const rows of tables) {
    it(JSON.stringify(rows).slice(0, 60), () => expect(parseBulk(serializeRows(rows))).toEqual(rows));
  }
});

describe("outside changes do not clobber the text", () => {
  it("text that already means the rows is left alone (blank lines, spacing)", () => {
    expect(textMeansRows("a:1\n\n  b:2", [r("a", "1"), r("b", "2")])).toBe(true);
    expect(textMeansRows("a:1", [r("a", "1"), r("b", "2")])).toBe(false);
    expect(textMeansRows("a:1", [r("a", "1"), r("", "")])).toBe(true); // ghost row
  });

  it("params in bulk + URL edit: the URL reconciles the rows, the bulk text follows", () => {
    // Bulk adds a line -> rows -> the URL input shows it.
    let rows = parseBulk("q:1\n//off:x\npage:2");
    expect(serializeUrl("https://api.io/s", rows)).toBe("https://api.io/s?q=1&page=2");
    // Editing the URL reconciles the enabled rows (disabled untouched) -> new bulk text.
    rows = applyUrlInput("https://api.io/s?q=1&page=3&sort=asc", rows).rows;
    expect(serializeRows(rows)).toBe("q:1\n//off:x\npage:3\nsort:asc");
    expect(textMeansRows("q:1\n//off:x\npage:2", rows)).toBe(false); // so the editor is rewritten
  });
});
