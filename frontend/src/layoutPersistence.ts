// Editor-group layout persistence: versioned JSON per user + project (Go:
// GetLayout / SetLayout, settings key ui_layout_<user>_<project>). Restoring
// validates and repairs the stored tree (layoutTree.parseLayout), drops tabs whose
// target is gone (deleted or no longer accessible) and collapses what empties;
// unreadable data falls back to one empty group — never a crash. Saving is
// debounced (300 ms) and flushed on quit.
import { allTabs, Layout, parseLayout, pruneTabs, serializeLayout, singleGroup } from "./layoutTree";
import { isTabKey, refFromKey, TabRef } from "./tabModel";

export interface LayoutStorage {
  get: (projectId: string) => Promise<string>;
  set: (projectId: string, json: string) => Promise<unknown>;
}

export const LAYOUT_SAVE_DELAY_MS = 300;

export const saveLayout = (storage: LayoutStorage, projectId: string, l: Layout) =>
  storage.set(projectId, JSON.stringify(serializeLayout(l)));

export function readLayout(raw: string): Layout | null {
  if (!raw) return null;
  try {
    return parseLayout(JSON.parse(raw), isTabKey);
  } catch {
    return null; // not JSON
  }
}

// Returns the layout to show. `load` checks one tab and resolves false when its
// target is gone; those tabs are dropped and the cleaned layout written back.
export async function restoreLayout(
  storage: LayoutStorage,
  projectId: string,
  load: (ref: TabRef) => Promise<boolean>,
): Promise<Layout> {
  const raw = await storage.get(projectId);
  const parsed = readLayout(raw);
  const layout = parsed ?? singleGroup();
  const keys = allTabs(layout.root);
  const present = await Promise.all(keys.map((k) => load(refFromKey(k)!).catch(() => false)));
  const gone = new Set(keys.filter((_, i) => !present[i]));
  const out = gone.size > 0 ? pruneTabs(layout, (k) => !gone.has(k)) : layout;
  if (gone.size > 0 || (raw !== "" && !parsed)) await saveLayout(storage, projectId, out);
  return out;
}

// One debounced writer per project; flush() writes a pending change right away.
export function createLayoutSaver(write: () => Promise<unknown>, delayMs = LAYOUT_SAVE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const run = async () => {
    timer = undefined;
    if (!pending) return;
    pending = false;
    await write();
  };
  return {
    change() {
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    async flush() {
      clearTimeout(timer);
      await run();
    },
    cancel() {
      clearTimeout(timer);
      pending = false;
    },
  };
}
