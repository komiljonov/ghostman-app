// Open tabs are persisted per project as typed refs in tab-bar order
// (ui_tabs_<project_id>). Restoring drops tabs whose target is gone, silently, and
// reads the old bare-id format as request tabs (see tabModel.normalizeSaved).
import { normalizeSaved, SavedTabs, sameTab, TabRef, tabKey } from "./tabModel";

export type { SavedTabs };

const NONE = { kind: "", id: "" };

export interface TabStorage {
  get: (projectId: string) => Promise<unknown>;
  set: (projectId: string, tabs: { open: TabRef[]; active: TabRef | typeof NONE }) => Promise<unknown>;
}

export function saveTabs(storage: TabStorage, projectId: string, open: TabRef[], active: TabRef | undefined) {
  const isOpen = active && open.some((t) => sameTab(t, active));
  return storage.set(projectId, { open: open.map((t) => ({ ...t })), active: isOpen ? { ...active! } : NONE });
}

// Returns the tabs to reopen. `load` checks one tab and resolves false when its
// target is gone (deleted, or no longer accessible); those are dropped and the
// cleaned-up list is written back. The active tab falls back to the last one.
export async function restoreTabs(
  storage: TabStorage,
  projectId: string,
  load: (ref: TabRef) => Promise<boolean>,
): Promise<SavedTabs> {
  const raw = await storage.get(projectId);
  const saved = normalizeSaved(raw);
  const present = await Promise.all(saved.open.map((ref) => load(ref).catch(() => false)));
  const open = saved.open.filter((_, i) => present[i]);
  const active = saved.active && open.some((t) => sameTab(t, saved.active)) ? saved.active : open[open.length - 1];
  const changed = open.length !== saved.open.length || tabKey(active ?? { kind: "env_list", id: "-" }) !==
    tabKey(saved.active ?? { kind: "env_list", id: "-" });
  // Also rewrite when the stored data was in the old format, so it is migrated once.
  const legacy = JSON.stringify(raw ?? {}).includes('"open":["');
  if (changed || legacy) await saveTabs(storage, projectId, open, active);
  return { open, active };
}
