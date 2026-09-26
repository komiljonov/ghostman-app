// Open tabs are persisted per project as ids only (ui_tabs_<project_id>).
// Restoring drops requests that no longer exist, silently.

export interface SavedTabs {
  open: string[];
  active: string;
}

export interface TabStorage {
  get: (projectId: string) => Promise<SavedTabs>;
  set: (projectId: string, tabs: SavedTabs) => Promise<unknown>;
}

export function saveTabs(storage: TabStorage, projectId: string, open: string[], active: string | undefined) {
  return storage.set(projectId, { open: [...open], active: active && open.includes(active) ? active : "" });
}

// Returns the tabs to reopen. `load` fetches one request and resolves false when it
// is gone (deleted, or no longer accessible); those are dropped and the cleaned-up
// list is written back. The active tab falls back to the last remaining one.
export async function restoreTabs(
  storage: TabStorage,
  projectId: string,
  load: (id: string) => Promise<boolean>,
): Promise<SavedTabs> {
  const saved = await storage.get(projectId);
  const unique = [...new Set(saved.open ?? [])];
  const present = await Promise.all(unique.map((id) => load(id).catch(() => false)));
  const open = unique.filter((_, i) => present[i]);
  const active = open.includes(saved.active) ? saved.active : (open[open.length - 1] ?? "");
  if (open.length !== unique.length || active !== saved.active) {
    await storage.set(projectId, { open, active });
  }
  return { open, active };
}
