import { describe, expect, it } from "vitest";
import { fileSummary, importDestination, progressLabel, reportSections, summaryLine } from "./importReport";
import type { importer } from "../wailsjs/go/models";

const entry = (severity: string, message = "x") => ({ severity, code: "c", path: "A / B", message }) as importer.Entry;

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
    const summary = { folders: 7, requests: 1, environments: 0, variables: 0 } as importer.Summary;
    expect(summaryLine({ kind: "collection", summary })).toBe("7 folders, 1 request");
    expect(summaryLine({ kind: "environment", summary: { ...summary, environments: 1, variables: 0 } as importer.Summary }))
      .toBe("1 environment, 0 variables");
  });
  it("summarises an OpenAPI import and describes the spec", () => {
    const summary = { folders: 86, requests: 464, environments: 2, variables: 2 } as importer.Summary;
    expect(summaryLine({ kind: "openapi", summary })).toBe("86 folders, 464 requests, 2 environments");
    expect(fileSummary({ kind: "openapi", format: "OpenAPI 3.0.0", folders: 85, requests: 464, variables: 0, servers: 2 }))
      .toBe("API spec · OpenAPI 3.0.0 · 85 tags, 464 operations, 2 servers");
    expect(importDestination("openapi")).toContain("one environment per server");
    expect(importDestination(undefined)).toBe("");
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
