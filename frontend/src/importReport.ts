// The Postman import report dialog's view model. Go builds the report (complete
// accounting, internal/postman); this only decides how it is laid out: the four
// sections in order, which are shown (empty ones are hidden) and open, and the
// one-line summaries. Pinned by importReport.test.ts.
import type { postman } from "../wailsjs/go/models";

export type SectionKey = "imported" | "changed" | "dropped" | "failed";

export interface Section {
  key: SectionKey;
  title: string;
  icon: "check-circle" | "alert" | "ban" | "x-circle";
  entries: postman.Entry[];
  open: boolean; // initially expanded
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "4 folders, 12 requests" — only the kinds this import can create, zeros kept
// for those (so "0 requests" is visible when nothing made it).
export function summaryLine(r: Pick<postman.Report, "kind" | "summary">): string {
  const s = r.summary;
  if (r.kind === "environment") {
    return [plural(s.environments, "environment", "environments"), plural(s.variables, "variable", "variables")].join(", ");
  }
  return [plural(s.folders, "folder", "folders"), plural(s.requests, "request", "requests")].join(", ");
}

// The sections in the report's order; empty ones are left out. Problems start
// open, the (long) list of created items starts collapsed.
export function reportSections(r: Pick<postman.Report, "imported" | "changed" | "dropped" | "failed">): Section[] {
  const all: Section[] = [
    { key: "imported", title: "Imported", icon: "check-circle", entries: r.imported ?? [], open: false },
    { key: "changed", title: "Imported with changes", icon: "alert", entries: r.changed ?? [], open: true },
    { key: "dropped", title: "Dropped", icon: "ban", entries: r.dropped ?? [], open: true },
    { key: "failed", title: "Failed", icon: "x-circle", entries: r.failed ?? [], open: true },
  ];
  return all.filter((s) => s.entries.length > 0);
}

// The picked file as the modal describes it: "Postman collection · Collection v2.1 · 6 folders, 21 requests".
export function fileSummary(f: { kind: string; format: string; folders: number; requests: number; variables: number }): string {
  const what = f.kind === "environment" ? "Postman environment" : "Postman collection";
  const counts = f.kind === "environment"
    ? plural(f.variables, "variable", "variables")
    : `${plural(f.folders, "folder", "folders")}, ${plural(f.requests, "request", "requests")}`;
  return `${what} · ${f.format} · ${counts}`;
}

// "Imported 34 of 120" while running ("Starting…" before the first item).
export function progressLabel(p: { done: number; total: number } | undefined): string {
  if (!p || p.total === 0) return "Starting…";
  return `Imported ${p.done} of ${p.total}`;
}
