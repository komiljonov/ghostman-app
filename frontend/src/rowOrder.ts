// Order math of the shared row drag and drop (rowDrag.ts): where a dragged row
// lands among a list's rows, and the list's new order. Pure, unit-tested.

export interface RowRect {
  id: string;
  top: number;
  bottom: number;
}

// The insertion index for pointer y: before the first row whose middle is below
// y; past the last row → rows.length.
export function insertIndex(rows: RowRect[], y: number): number {
  const i = rows.findIndex((r) => y < (r.top + r.bottom) / 2);
  return i < 0 ? rows.length : i;
}

// The list's new order with draggedId inserted at index (an index into the list
// as it is, dragged row included), or null when nothing would change (dropped on
// its own place or the gap right after it, or unknown id).
export function reorderIds(ids: string[], draggedId: string, index: number): string[] | null {
  const from = ids.indexOf(draggedId);
  if (from < 0 || index === from || index === from + 1) return null;
  const rest = ids.filter((id) => id !== draggedId);
  const at = Math.max(0, Math.min(rest.length, index > from ? index - 1 : index));
  return [...rest.slice(0, at), draggedId, ...rest.slice(at)];
}

// Where the insertion line goes for an index: the top of that row, or the bottom
// of the last row.
export function lineY(rows: RowRect[], index: number): number {
  if (rows.length === 0) return 0;
  return index < rows.length ? rows[index].top : rows[rows.length - 1].bottom;
}

export interface SaveOrderDeps {
  save: (order: string[]) => Promise<{ error?: { message: string } | null }>;
  reload: () => unknown; // re-fetch the list: shows the new order, or restores the old one after a failure
  onError: (message: string | undefined) => void;
}

// Persists a dropped order through the surface's order endpoint, then re-fetches
// (server data is never patched locally): on success the list shows the new
// order; a failed save shows its message and the re-fetch restores the old order.
export async function saveOrder(order: string[], deps: SaveOrderDeps): Promise<boolean> {
  const r = await deps.save(order);
  deps.onError(r.error?.message);
  await deps.reload();
  return !r.error;
}

// For draft rows (params / headers / form / multipart): the rows array in the
// order of their index ids ("0", "1", …).
export function reorderByIndex<T>(rows: T[], order: string[]): T[] {
  return order.map((i) => rows[Number(i)]);
}
