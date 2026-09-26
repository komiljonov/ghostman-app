// Row-table editing (headers, query params, form fields). The table always shows
// the real rows plus one trailing empty "ghost" row; typing into the ghost row
// appends a real row, so there is always a fresh row to type into. Pure functions
// returning new arrays — callers store the result.

export interface Row {
  key: string;
  value: string;
  enabled: boolean;
}

export const newRow = (patch: Partial<Row> = {}): Row => ({ key: "", value: "", enabled: true, ...patch });

// Index === rows.length addresses the ghost row.
export function isGhost(rows: Row[], index: number): boolean {
  return index === rows.length;
}

export function editRow(rows: Row[], index: number, patch: Partial<Row>): Row[] {
  if (isGhost(rows, index)) return [...rows, newRow(patch)];
  if (index < 0 || index > rows.length) return rows;
  return rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
}

export function toggleRow(rows: Row[], index: number): Row[] {
  if (index < 0 || index >= rows.length) return rows; // the ghost row has nothing to toggle
  return rows.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r));
}

export function removeRow(rows: Row[], index: number): Row[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.filter((_, i) => i !== index);
}
