import { describe, expect, it } from "vitest";
import { fileSummary, progressLabel, reportSections, summaryLine } from "./importReport";
import type { postman } from "../wailsjs/go/models";

const entry = (severity: string, message = "x") => ({ severity, code: "c", path: "A / B", message }) as postman.Entry;

describe("import report layout", () => {
  it("keeps the four sections in order and hides empty ones", () => {
    const r = { imported: [entry("imported")], changed: [], dropped: [entry("dropped")], failed: [entry("failed"), entry("failed")] };
    expect(reportSections(r).map((s) => [s.key, s.entries.length, s.open])).toEqual([
      ["imported", 1, false], // the created list starts collapsed
      ["dropped", 1, true],
      ["failed", 2, true],
    ]);
    expect(reportSections({ imported: [], changed: [], dropped: [], failed: [] })).toEqual([]);
  });
  it("summarises what was created, per kind", () => {
    const summary = { folders: 7, requests: 1, environments: 0, variables: 0 } as postman.Summary;
    expect(summaryLine({ kind: "collection", summary })).toBe("7 folders, 1 request");
    expect(summaryLine({ kind: "environment", summary: { ...summary, environments: 1, variables: 0 } as postman.Summary }))
      .toBe("1 environment, 0 variables");
  });
  it("describes the picked file", () => {
    expect(fileSummary({ kind: "collection", format: "Collection v2.1", folders: 6, requests: 21, variables: 0 }))
      .toBe("Postman collection · Collection v2.1 · 6 folders, 21 requests");
    expect(fileSummary({ kind: "environment", format: "Environment", folders: 0, requests: 0, variables: 1 }))
      .toBe("Postman environment · Environment · 1 variable");
  });
  it("labels progress", () => {
    expect(progressLabel(undefined)).toBe("Starting…");
    expect(progressLabel({ done: 34, total: 120 })).toBe("Imported 34 of 120");
  });
});
