// Tree commands that span several steps. The bridge work is one bound Go call
// (DuplicateRequest composes get/create/update and rolls back); this only
// sequences the UI around it: re-fetch the tree, then select and open the copy.
import type { session } from "../wailsjs/go/models";

export interface DuplicateDeps {
  duplicate: (id: string) => Promise<{ data?: { id: string } | null; error?: session.Problem }>;
  reload: () => Promise<void>;
  select: (id: string) => void;
  open: (id: string) => void;
}

// Returns the problem to show, or undefined on success.
export async function duplicateAndOpen(id: string, deps: DuplicateDeps): Promise<session.Problem | undefined> {
  const result = await deps.duplicate(id);
  if (result.error || !result.data) return result.error;
  await deps.reload(); // server data is never patched locally
  deps.select(result.data.id);
  deps.open(result.data.id);
  return undefined;
}

export interface CreateDeps {
  create: () => Promise<{ data?: { id: string } | null; error?: session.Problem }>;
  reload: () => Promise<void>;
  expand: (folderId: string) => void;
  select: (id: string) => void;
  open: (id: string) => void; // requests only: a folder has nothing to open
  rename: (id: string) => void;
}

// "+" / "New request" / "New folder": create, re-fetch, select the new node, open
// a new REQUEST in a tab, then start its inline rename. The tab opens before the
// rename starts, so the rename input (focused on mount) keeps the keyboard.
export async function createAndOpen(
  kind: "folder" | "request",
  parentId: string | undefined,
  deps: CreateDeps,
): Promise<session.Problem | undefined> {
  const result = await deps.create();
  if (result.error || !result.data) return result.error;
  if (parentId) deps.expand(parentId);
  await deps.reload(); // server data is never patched locally
  deps.select(result.data.id);
  if (kind === "request") deps.open(result.data.id);
  deps.rename(result.data.id);
  return undefined;
}
