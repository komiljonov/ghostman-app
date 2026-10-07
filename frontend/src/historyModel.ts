// History tab rules (pure, unit-tested in history.test.ts): what the filter bar
// sends to Go (all filtering happens in SQL), how list rows are labelled and
// grouped by day, what the detail pane shows, and the Settings prompts.
// The data itself lives in Go/SQLite (history.go); nothing here stores it.

export type StatusClass = "" | "2xx" | "3xx" | "4xx" | "5xx" | "err";

export const STATUS_CLASSES: { id: StatusClass; label: string }[] = [
  { id: "", label: "Any status" },
  { id: "2xx", label: "2xx" },
  { id: "3xx", label: "3xx" },
  { id: "4xx", label: "4xx" },
  { id: "5xx", label: "5xx" },
  { id: "err", label: "ERR" },
];

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const PAGE_SIZE = 100;

export interface FilterState {
  text: string;
  method: string; // "" = any
  status: StatusClass;
  currentProjectOnly: boolean; // default on
  requestId: string; // "" = all requests; else one request's sends (opened from its History sub-tab)
  requestName: string; // the chip's label
}

export const defaultFilter = (): FilterState => ({
  text: "", method: "", status: "", currentProjectOnly: true, requestId: "", requestName: "",
});

// The History tab filtered to one request (any other filter cleared).
export const requestFilter = (requestId: string, requestName: string): FilterState => ({
  ...defaultFilter(), requestId, requestName,
});

export interface Cursor {
  created_at: number;
  id: number;
}

// The bound ListHistory filter (main.HistoryFilter) for a filter state.
export function filterToQuery(f: FilterState, projectId: string, cursor?: Cursor) {
  return {
    project_id: f.currentProjectOnly ? projectId : "",
    request_id: f.requestId,
    query: f.text.trim(),
    method: f.method,
    status_class: f.status,
    before_created: cursor?.created_at ?? 0,
    before_id: cursor?.id ?? 0,
    limit: PAGE_SIZE,
  };
}

// The cursor for the page after `items` (keyset on created_at, id).
// The request editor's History sub-tab: that request's sends, newest first.
export const requestHistoryQuery = (requestId: string, cursor?: Cursor) =>
  filterToQuery({ ...defaultFilter(), currentProjectOnly: false, requestId }, "", cursor);

export const nextCursor = (items: { created_at: number; id: number }[]): Cursor | undefined => {
  const last = items[items.length - 1];
  return last ? { created_at: last.created_at, id: last.id } : undefined;
};

export interface SummaryLike {
  id: number;
  created_at: number;
  project_id: string;
  request_id: string;
  request_name: string;
  method: string;
  url_template: string;
  url_resolved: string;
  env_name: string;
  status: number;
  duration_ms: number;
  error: string;
}

// host + path of a URL ("" when it does not parse, e.g. still a {{template}}).
export function hostPath(raw: string): string {
  try {
    const u = new URL(raw);
    return u.host + (u.pathname === "/" && !raw.endsWith("/") ? "" : u.pathname);
  } catch {
    return "";
  }
}

// A row's title: the request's name at send time, else host+path, else the raw URL.
export function rowLabel(s: SummaryLike): string {
  if (s.request_name.trim()) return s.request_name.trim();
  return hostPath(s.url_resolved) || hostPath(s.url_template) || s.url_resolved || s.url_template;
}

// The status chip: class for its color and its text (ERR for no HTTP response).
export function statusChip(s: { status: number; error: string }): { cls: StatusClass; text: string } {
  if (s.error || s.status === 0) return { cls: "err", text: "ERR" };
  const c = Math.floor(s.status / 100);
  const cls: StatusClass = c === 2 ? "2xx" : c === 3 ? "3xx" : c === 4 ? "4xx" : c >= 5 ? "5xx" : "";
  return { cls, text: String(s.status) };
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// "Today" / "Yesterday" / "Mon, 3 Feb" / "Mon, 3 Feb 2025" (another year), local time.
export function dayLabel(t: number, now: number): string {
  const day = startOfDay(t);
  const today = startOfDay(now);
  if (day === today) return "Today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (day === y.getTime()) return "Yesterday";
  const d = new Date(t);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

export interface DayGroup<T> {
  key: number; // start of the day (local)
  label: string;
  items: T[];
}

// Groups newest-first items by local day, keeping their order.
export function groupByDay<T extends { created_at: number }>(items: T[], now: number): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const it of items) {
    const key = startOfDay(it.created_at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(it.created_at, now), items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const timeOfDay = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---- Detail pane ----

export type RequestForm = "template" | "resolved";

export interface FormLike {
  url: string;
  headers: { key: string; value: string; enabled: boolean }[];
  params: { key: string; value: string; enabled: boolean }[];
  body: string;
  body_type: string;
  content_type: string;
}

// What the request section shows for a form: the template lists every row as
// authored (disabled ones marked), the resolved form only what was sent.
export function formRows(form: FormLike, mode: RequestForm) {
  const rows = (list: FormLike["headers"]) =>
    list.filter((r) => r.key.trim() !== "").map((r) => ({ key: r.key, value: r.value, off: !r.enabled }));
  return {
    url: form.url,
    headers: rows(form.headers ?? []),
    params: mode === "template" ? rows(form.params ?? []) : [],
    body: form.body_type === "none" ? "" : form.body,
    bodyLabel: form.body_type === "form" ? "Form (urlencoded)" : form.body_type === "raw" ? form.content_type || "Raw" : "",
  };
}

// "Open original request" applies only to a request of the current project that
// is still in its tree.
export function canOpenOriginal(s: { project_id: string; request_id: string }, projectId: string, requestIds: Set<string>): { ok: boolean; why: string } {
  if (!s.request_id) return { ok: false, why: "This entry has no original request" };
  if (s.project_id !== projectId) return { ok: false, why: "The original request is in another project" };
  if (!requestIds.has(s.request_id)) return { ok: false, why: "The original request no longer exists" };
  return { ok: true, why: "" };
}

export interface RestoreDeps {
  restore: (id: number, projectId: string) => Promise<{ data?: { id: string } | null; error?: { message: string } }>;
  reloadTree: () => void;
  open: (requestId: string) => void;
}

// Restore to a new request (created at the project root by Go from the template
// form), then re-fetch the tree and open it. Returns the error message, if any.
export async function restoreAndOpen(entryId: number, projectId: string, deps: RestoreDeps): Promise<string | undefined> {
  if (!projectId) return "Select a project first";
  const result = await deps.restore(entryId, projectId);
  if (result.error || !result.data) return result.error?.message ?? "Could not restore the request";
  deps.reloadTree();
  deps.open(result.data.id);
  return undefined;
}

// ---- Settings ----

export const MAX_ENTRIES_CHOICES = [
  { value: 100, label: "100 entries" },
  { value: 500, label: "500 entries" },
  { value: 1000, label: "1,000 entries" },
  { value: 5000, label: "5,000 entries" },
  { value: 0, label: "Unlimited" },
];

export const MAX_RESPONSE_CHOICES = [
  { value: 1 << 20, label: "1 MB" },
  { value: 10 << 20, label: "10 MB" },
  { value: 50 << 20, label: "50 MB" },
  { value: 0, label: "Unlimited" },
];

// How many oldest entries a new max-entries value deletes (0 = no prompt needed).
export function entriesToDelete(rowCount: number, newMax: number): number {
  if (newMax <= 0) return 0;
  return Math.max(0, rowCount - newMax);
}

export const storageLine = (rows: number, bytes: number) =>
  `${rows.toLocaleString("en-US")} ${rows === 1 ? "entry" : "entries"} · ${formatBytes(bytes)}`;

export type ClearScope = "all" | "older_than_30d" | "current_project";

export const CLEAR_SCOPES: { id: ClearScope; label: string; confirm: string }[] = [
  { id: "all", label: "All history", confirm: "Delete all history?" },
  { id: "older_than_30d", label: "Older than 30 days", confirm: "Delete history older than 30 days?" },
  { id: "current_project", label: "Current project", confirm: "Delete this project's history?" },
];
