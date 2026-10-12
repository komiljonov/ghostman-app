// The import report dialog's view model. Go builds the report (complete
// accounting, internal/importer); this only decides how it is laid out: the four
// sections in order, which are shown (empty ones are hidden) and open, and the
// one-line summaries. Pinned by importReport.test.ts.
import type { importer } from "../wailsjs/go/models";

export type SectionKey = "imported" | "changed" | "dropped" | "failed";

export interface Section {
  key: SectionKey;
  title: string;
  icon: "check-circle" | "alert" | "ban" | "x-circle";
  entries: importer.Entry[];
  open: boolean; // initially expanded
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "4 folders, 12 requests" — only the kinds this import can create, zeros kept
// for those (so "0 requests" is visible when nothing made it).
export function summaryLine(r: Pick<importer.Report, "kind" | "summary">): string {
  const s = r.summary;
  if (r.kind === "openapi") {
    return [plural(s.folders, "folder", "folders"), plural(s.requests, "request", "requests"),
      plural(s.environments, "environment", "environments")].join(", ");
  }
  if (r.kind === "environment") {
    return [plural(s.environments, "environment", "environments"), plural(s.variables, "variable", "variables")].join(", ");
  }
  return [plural(s.folders, "folder", "folders"), plural(s.requests, "request", "requests")].join(", ");
}

// The sections in the report's order; empty ones are left out. Problems start
// open, the (long) list of created items starts collapsed.
export function reportSections(r: Pick<importer.Report, "imported" | "changed" | "dropped" | "failed">): Section[] {
  const all: Section[] = [
    { key: "imported", title: "Imported", icon: "check-circle", entries: r.imported ?? [], open: false },
    { key: "changed", title: "Imported with changes", icon: "alert", entries: r.changed ?? [], open: true },
    { key: "dropped", title: "Dropped", icon: "ban", entries: r.dropped ?? [], open: true },
    { key: "failed", title: "Failed", icon: "x-circle", entries: r.failed ?? [], open: true },
  ];
  return all.filter((s) => s.entries.length > 0);
}

// The picked file as the modal describes it: "Postman collection · Collection v2.1 · 6 folders, 21 requests",
// "API spec · OpenAPI 3.0.0 · 85 tags, 464 operations, 2 servers".
export function fileSummary(f: {
  kind: string; format: string; folders: number; requests: number; variables: number; servers?: number;
}): string {
  if (f.kind === "openapi") {
    return `API spec · ${f.format} · ${plural(f.folders, "tag", "tags")}, ${plural(f.requests, "operation", "operations")}, ` +
      plural(f.servers ?? 0, "server", "servers");
  }
  const what = f.kind === "environment" ? "Postman environment" : "Postman collection";
  const counts = f.kind === "environment"
    ? plural(f.variables, "variable", "variables")
    : `${plural(f.folders, "folder", "folders")}, ${plural(f.requests, "request", "requests")}`;
  return `${what} · ${f.format} · ${counts}`;
}

// Where the modal says the import will land.
export function importDestination(kind: string | undefined): string {
  switch (kind) {
    case "environment":
      return "as a new environment";
    case "openapi":
      return "as one new folder (one sub-folder per tag) plus one environment per server";
    case "collection":
      return "as one new folder at the top of the tree";
  }
  return "";
}

// "Imported 34 of 120" while running ("Starting…" before the first item).
export function progressLabel(p: { done: number; total: number } | undefined): string {
  if (!p || p.total === 0) return "Starting…";
  return `Imported ${p.done} of ${p.total}`;
}
