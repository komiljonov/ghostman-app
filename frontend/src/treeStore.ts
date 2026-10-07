// The current project's tree (folders + requests from the last ListFolders +
// ListRequests), shared read-only with the rest of the UI so cascading settings
// resolve reactively: a folder setting change, a move or a rename re-fetches the
// tree, and everything reading it — open tabs included — re-resolves. ProjectTree
// is the only writer.
import { createSignal } from "solid-js";
import type { Tree } from "./tree";

const empty = (): Tree => ({ root: [], folders: new Map(), requests: new Map(), requestCount: 0 });

const [tree, setTree] = createSignal<Tree>(empty());
const [reloadTick, setReloadTick] = createSignal(0);

export const currentTree = tree;
export const publishTree = (t: Tree) => setTree(t);
export const clearTree = () => setTree(empty());

// Ask ProjectTree to re-fetch (after a setting was saved elsewhere, e.g. a tab).
export const treeReloadTick = reloadTick;
export const requestTreeReload = () => setReloadTick((n) => n + 1);
