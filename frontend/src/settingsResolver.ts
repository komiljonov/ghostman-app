// Cascading settings resolution — the one mechanism for every per-node setting
// (follow_redirects now; auth, proxy later). The server only stores each node's
// value; resolution happens here, purely over the tree store (the folder and
// request lists already carry the fields) plus the global value: no bridge calls.
//
// Values at each level (a request, then its folders bottom-up):
//   explicit (e.g. "on" / "off")  → that value, from that node
//   "global"                      → the global value; the walk STOPS (ancestors ignored)
//   "inherit"                     → ask the next ancestor; past the root → global
import type { NodeSettingKey, Tree, TreeNode } from "./tree";

export const INHERIT = "inherit";
export const GLOBAL = "global";

// One level of the chain: the node's own value for the setting.
export interface Level {
  id: string;
  kind: "request" | "folder";
  name: string;
  value: string; // "inherit" | "global" | an explicit value
}

export type Source =
  | { kind: "node"; id: string; nodeKind: "request" | "folder"; name: string }
  | { kind: "global" };

export interface Resolved<T> {
  value: T;
  source: Source;
}

// node first, then its ancestors from the nearest folder up to the root.
export function resolveSetting<T>(node: Level, ancestorsBottomUp: Level[], globalValue: T, explicit: (v: string) => T | undefined): Resolved<T> {
  for (const level of [node, ...ancestorsBottomUp]) {
    if (level.value === GLOBAL) return { value: globalValue, source: { kind: "global" } };
    if (level.value === INHERIT || level.value === "") continue;
    const v = explicit(level.value);
    if (v === undefined) continue; // unknown value (newer server?): treat as inherit
    return { value: v, source: { kind: "node", id: level.id, nodeKind: level.kind, name: level.name } };
  }
  return { value: globalValue, source: { kind: "global" } };
}

const levelOf = (n: TreeNode, key: NodeSettingKey): Level => ({ id: n.id, kind: n.kind, name: n.name, value: n.settings[key] ?? INHERIT });

// The folders above a node, nearest first.
export function ancestorFolders(tree: Tree, node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  let parentId = node.kind === "folder" ? node.parentId : node.folderId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const f = tree.folders.get(parentId);
    if (!f) break;
    out.push(f);
    parentId = f.parentId;
  }
  return out;
}

// Resolve a setting for a request or folder by id, from the tree store.
export function resolveInTree<T>(tree: Tree, id: string, key: NodeSettingKey, globalValue: T, explicit: (v: string) => T | undefined): Resolved<T> | undefined {
  const node = tree.requests.get(id) ?? tree.folders.get(id);
  if (!node) return undefined;
  return resolveSetting(levelOf(node, key), ancestorFolders(tree, node).map((f) => levelOf(f, key)), globalValue, explicit);
}

// What a node would get if its own value were "inherit": the chain above it.
export function resolveParent<T>(tree: Tree, id: string, key: NodeSettingKey, globalValue: T, explicit: (v: string) => T | undefined): Resolved<T> | undefined {
  const node = tree.requests.get(id) ?? tree.folders.get(id);
  if (!node) return undefined;
  const self: Level = { ...levelOf(node, key), value: INHERIT };
  return resolveSetting(self, ancestorFolders(tree, node).map((f) => levelOf(f, key)), globalValue, explicit);
}

export function sourceLabel(source: Source): string {
  if (source.kind === "global") return "global";
  return source.nodeKind === "folder" ? `from folder ‘${source.name}’` : "this request";
}
