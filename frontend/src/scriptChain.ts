// The folder chain whose scripts run around a request's own (Go runs them:
// internal/scripting). OUTERMOST folder first — the same tree walk as settings
// resolution, but scripts ACCUMULATE (every folder's script runs), they do not
// inherit / override. Pure: over the tree store's already-fetched tree.
import type { Tree } from "./tree";

export interface ScriptFolder {
  name: string;
  pre_script: string;
  post_script: string;
}

export function scriptChain(tree: Tree, requestId: string): ScriptFolder[] {
  const chain: ScriptFolder[] = [];
  const seen = new Set<string>();
  let id = tree.requests.get(requestId)?.folderId ?? null;
  while (id !== null && !seen.has(id)) {
    seen.add(id); // a broken parent loop must not hang the send
    const f = tree.folders.get(id);
    if (!f) break;
    chain.push({ name: f.name, pre_script: f.preScript, post_script: f.postScript });
    id = f.parentId;
  }
  return chain.reverse();
}

// The Scripts sub-tab's dot: the request has a script of its own.
export const hasScripts = (d: { pre_script?: string; post_script?: string }) =>
  !!(d.pre_script?.trim() || d.post_script?.trim());
