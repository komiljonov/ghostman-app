// Form-data (multipart) rows: pure rules for the table, the file cells and the
// bulk view. No Solid, no bindings — unit-tested in multipart.test.ts.
//
// A row is text (value, {{vars}} allowed) or a file. A file row carries only its
// DISPLAY name (synced with the team); which file it is lives on this machine
// (Go: request_files, keyed by request + field key — so two file rows with the
// same key are not supported: choosing a file is blocked then). A row keeps its
// value and its file name while its kind is toggled; Go stores only the fields
// of the current kind.
import type { Row } from "./rows";

export type PartKind = "text" | "file";

export interface Part {
  key: string;
  kind: PartKind;
  value: string;
  file_name: string;
  enabled: boolean;
}

export const newPart = (patch: Partial<Part> = {}): Part => ({ key: "", kind: "text", value: "", file_name: "", enabled: true, ...patch });

// The server sends a multipart body's rows as `fields`; anything odd becomes text.
export function partsFrom(raw: unknown): Part[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Partial<Part>;
    return newPart({
      key: o.key ?? "", kind: o.kind === "file" ? "file" : "text", value: o.value ?? "", file_name: o.file_name ?? "",
      enabled: o.enabled ?? true,
    });
  });
}

// ---- Row editing (index === parts.length is the trailing ghost row) ----

export function editPart(parts: Part[], index: number, patch: Partial<Part>): Part[] {
  if (index === parts.length) return [...parts, newPart(patch)];
  if (index < 0 || index > parts.length) return parts;
  return parts.map((p, i) => (i === index ? { ...p, ...patch } : p));
}

export const setKind = (parts: Part[], index: number, kind: PartKind) => editPart(parts, index, { kind });

export function togglePart(parts: Part[], index: number): Part[] {
  if (index < 0 || index >= parts.length) return parts;
  return parts.map((p, i) => (i === index ? { ...p, enabled: !p.enabled } : p));
}

export function removePart(parts: Part[], index: number): Part[] {
  if (index < 0 || index >= parts.length) return parts;
  return parts.filter((_, i) => i !== index);
}

// ---- Files ----

// Why a file cannot be chosen for row `index` (undefined = it can).
export function chooseBlocked(parts: Part[], index: number): string | undefined {
  const key = (parts[index]?.key ?? "").trim();
  if (key === "") return "Give the field a key first";
  const clash = parts.some((p, i) => i !== index && p.kind === "file" && p.key.trim() === key);
  if (clash) return `Another file field is named “${key}” — file field keys must be unique`;
  return undefined;
}

// What Go knows about a field's local file (main.RequestFile).
export interface LocalFile {
  key: string;
  path: string;
  file_name: string;
  size: number;
  exists: boolean;
}

// Whether editing row `index`'s key to `next` moves its local file along: only
// when the row alone owns its old key among the file rows (else the path is
// another row's too) and no other file row holds the new key (that path would be
// overwritten). Otherwise the path stays where it is.
export function movesFile(parts: Part[], index: number, next: string): boolean {
  const row = parts[index];
  if (!row || row.kind !== "file") return false;
  const from = row.key.trim(), to = next.trim();
  if (from === "" || from === to) return false;
  const others = parts.filter((p, i) => i !== index && p.kind === "file").map((p) => p.key.trim());
  return !others.includes(from) && !others.includes(to);
}

export type FileState = "chosen" | "missing" | "elsewhere" | "empty";

// chosen: a local file that exists · missing: chosen here, gone from disk now ·
// elsewhere: the row names a file but this machine has none (a teammate's, or a
// restored / duplicated request) · empty: nothing picked yet.
export function fileState(part: Part, local: LocalFile | undefined): FileState {
  if (local) return local.exists ? "chosen" : "missing";
  return part.file_name ? "elsewhere" : "empty";
}

export function fileLabel(part: Part, local: LocalFile | undefined): { text: string; title: string } {
  const name = part.file_name || local?.file_name || "";
  switch (fileState(part, local)) {
    case "chosen":
      return { text: name, title: local!.path };
    case "missing":
      return { text: `${name} — missing on this machine`, title: `${local!.path} no longer exists — choose the file again` };
    case "elsewhere":
      return { text: `${name} — no file on this machine`, title: "Picked on another machine — choose the file here to send it" };
    default:
      return { text: "", title: "" };
  }
}

// ---- Bulk view ----
// Text rows edit as usual (bulkEdit.ts format). File rows are READ-ONLY there:
// shown as `key: [file] name` above the editor and never parsed from text — the
// table is where files are chosen. An edit replaces the text rows in their
// slots, keeping every file row where it was.

export const fileLine = (p: Part) => `${p.enabled ? "" : "//"}${p.key}: [file] ${p.file_name || "(none)"}`;

export const fileLines = (parts: Part[]) => parts.filter((p) => p.kind === "file").map(fileLine);

export const textRows = (parts: Part[]): Row[] =>
  parts.filter((p) => p.kind !== "file").map((p) => ({ key: p.key, value: p.value, enabled: p.enabled }));

export function mergeTextRows(parts: Part[], rows: Row[]): Part[] {
  const out: Part[] = [];
  let next = 0;
  for (const p of parts) {
    if (p.kind === "file") {
      out.push(p);
    } else if (next < rows.length) {
      const r = rows[next++];
      out.push({ ...p, key: r.key, value: r.value, enabled: r.enabled });
    }
  }
  for (; next < rows.length; next++) out.push(newPart({ key: rows[next].key, value: rows[next].value, enabled: rows[next].enabled }));
  return out;
}
