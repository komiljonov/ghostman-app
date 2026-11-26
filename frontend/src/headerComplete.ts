// Header-editing completion rules (the headers table: request editor and the
// webhook response headers — one component). Pure: the CodeMirror glue is
// headerKeySource / headerValueSource in codemirror.ts.
//   KEY cells:   outside an unclosed "{{" (that stays the {{var}} completion's),
//                the word before the cursor ([A-Za-z0-9-]) filters two groups —
//                RECENT (keys committed in this project, local; newest first)
//                above COMMON (a static list) — prefix matches before substring
//                matches, case-insensitive; inserted in canonical casing.
//   VALUE cells: no header names. When the row's key is Content-Type, common
//                mime types (same filtering); {{vars}} as everywhere.

export const COMMON_HEADERS = [
  "Accept", "Accept-Charset", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control",
  "Connection", "Content-Disposition", "Content-Encoding", "Content-Language", "Content-Length", "Content-Type",
  "Cookie", "DNT", "Forwarded", "Host", "If-Match", "If-Modified-Since", "If-None-Match", "If-Range",
  "If-Unmodified-Since", "Idempotency-Key", "Origin", "Pragma", "Prefer", "Range", "Referer", "TE",
  "Upgrade", "User-Agent", "Via", "X-Api-Key", "X-CSRF-Token", "X-Correlation-ID", "X-Forwarded-For",
  "X-Forwarded-Host", "X-Forwarded-Proto", "X-HTTP-Method-Override", "X-Request-ID", "X-Requested-With",
] as const;

export const MIME_TYPES = [
  "application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain",
  "application/xml", "text/html", "text/csv", "application/octet-stream",
] as const;

export type HeaderGroup = "recent" | "common";

export interface HeaderOption {
  label: string;
  group: HeaderGroup;
}

export const GROUP_LABEL: Record<HeaderGroup, string> = { recent: "Recently used", common: "Common headers" };

// The canonical spelling of a known header ("content-type" → "Content-Type");
// anything else as typed (trimmed).
export function canonicalHeader(key: string): string {
  const k = key.trim();
  return COMMON_HEADERS.find((h) => h.toLowerCase() === k.toLowerCase()) ?? k;
}

// Prefix matches first, then substring matches; each in list order. "" = all.
function rank(list: readonly string[], query: string): string[] {
  const q = query.toLowerCase();
  if (q === "") return [...list];
  const prefix = list.filter((x) => x.toLowerCase().startsWith(q));
  const inner = list.filter((x) => !x.toLowerCase().startsWith(q) && x.toLowerCase().includes(q));
  return [...prefix, ...inner];
}

// Options for a KEY cell: recent above common; each name once (a recent common
// header is listed under Recent only); an exact, complete match offers nothing.
export function headerKeyOptions(query: string, recent: readonly string[]): HeaderOption[] {
  const seen = new Set<string>();
  const out: HeaderOption[] = [];
  const add = (label: string, group: HeaderGroup) => {
    const k = label.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label, group });
  };
  for (const r of rank(recent.map(canonicalHeader), query)) add(r, "recent");
  for (const c of rank(COMMON_HEADERS, query)) add(c, "common");
  if (out.length === 1 && out[0].label.toLowerCase() === query.toLowerCase()) return [];
  return out;
}

export const isContentType = (key: string) => key.trim().toLowerCase() === "content-type";

// Options for a VALUE cell given its row's key: mime types for Content-Type only.
export function headerValueOptions(key: string, query: string): string[] {
  if (!isContentType(key)) return [];
  const opts = rank(MIME_TYPES, query);
  return opts.length === 1 && opts[0] === query ? [] : opts;
}

// The word being typed before the cursor in a header cell (header names and mime
// types: letters, digits, "-", "/", ".", "+").
export function wordBefore(textBefore: string): { word: string; start: number } {
  const m = /[A-Za-z0-9\-/.+]*$/.exec(textBefore)!;
  return { word: m[0], start: textBefore.length - m[0].length };
}
