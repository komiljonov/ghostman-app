// Builds the sidebar tree from the server's two flat lists (folders, requests).
// Pure functions only — no Solid, no bindings — so it is unit-testable.

export interface FolderInput {
  id: string;
  parent_id?: string | null; // null/undefined = project root
  name: string;
  sort_order: number;
}

export interface RequestInput {
  id: string;
  folder_id?: string | null; // null/undefined = project root
  name: string;
  method: string;
  url: string;
  sort_order: number;
}

export interface FolderNode {
  kind: "folder";
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  children: TreeNode[]; // folders first, then requests, each by sort_order
}

export interface RequestNode {
  kind: "request";
  id: string;
  folderId: string | null;
  name: string;
  method: string;
  url: string;
  sortOrder: number;
}

export type TreeNode = FolderNode | RequestNode;

export interface Tree {
  root: TreeNode[];
  folders: Map<string, FolderNode>;
  requests: Map<string, RequestNode>;
  requestCount: number;
}

const bySortOrder = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

// Folders before requests within a level, each group by sort_order.
function sortLevel(nodes: TreeNode[]): TreeNode[] {
  const folders = nodes.filter((n): n is FolderNode => n.kind === "folder").sort(bySortOrder);
  const requests = nodes.filter((n): n is RequestNode => n.kind === "request").sort(bySortOrder);
  return [...folders, ...requests];
}

export function buildTree(
  folderList: FolderInput[],
  requestList: RequestInput[],
  warn: (msg: string) => void = console.warn,
): Tree {
  const folders = new Map<string, FolderNode>();
  for (const f of folderList) {
    folders.set(f.id, { kind: "folder", id: f.id, parentId: f.parent_id ?? null, name: f.name, sortOrder: f.sort_order, children: [] });
  }

  const root: TreeNode[] = [];
  const place = (node: TreeNode, parentId: string | null, what: string) => {
    if (parentId === null) {
      root.push(node);
      return;
    }
    const parent = folders.get(parentId);
    if (!parent) {
      warn(`tree: ${what} ${node.id} refers to unknown folder ${parentId}; showing it at the project root`);
      if (node.kind === "folder") node.parentId = null;
      else node.folderId = null;
      root.push(node);
      return;
    }
    parent.children.push(node);
  };

  for (const f of folders.values()) place(f, f.parentId, "folder");

  // Defensive: folders whose parent chain loops are unreachable from the root.
  const reachable = new Set<string>();
  const mark = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === "folder" && !reachable.has(n.id)) {
        reachable.add(n.id);
        mark(n.children);
      }
    }
  };
  mark(root);
  for (const f of folders.values()) {
    if (!reachable.has(f.id)) {
      warn(`tree: folder ${f.id} is part of a parent cycle; showing it at the project root`);
      const parent = f.parentId ? folders.get(f.parentId) : undefined;
      if (parent) parent.children = parent.children.filter((c) => c !== f);
      f.parentId = null;
      root.push(f);
      mark([f]);
    }
  }

  const requests = new Map<string, RequestNode>();
  for (const r of requestList) {
    const node: RequestNode = {
      kind: "request", id: r.id, folderId: r.folder_id ?? null, name: r.name, method: r.method, url: r.url, sortOrder: r.sort_order,
    };
    requests.set(r.id, node);
    place(node, node.folderId, "request");
  }

  const sortAll = (nodes: TreeNode[]): TreeNode[] =>
    sortLevel(nodes).map((n) => {
      if (n.kind === "folder") n.children = sortAll(n.children);
      return n;
    });

  return { root: sortAll(root), folders, requests, requestCount: requests.size };
}

// The nodes at the same level as `node` (same kind), in order.
function siblings(tree: Tree, node: TreeNode): TreeNode[] {
  const parentId = node.kind === "folder" ? node.parentId : node.folderId;
  const level = parentId === null ? tree.root : tree.folders.get(parentId)?.children ?? [];
  return level.filter((n) => n.kind === node.kind);
}

// The full sibling id list after moving `node` one step up (-1) or down (+1), or
// null when it is already at that edge. The reorder endpoints want exactly this list.
export function reorderedSiblingIds(tree: Tree, node: TreeNode, offset: -1 | 1): string[] | null {
  const ids = siblings(tree, node).map((n) => n.id);
  const from = ids.indexOf(node.id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

export function canMove(tree: Tree, node: TreeNode, offset: -1 | 1): boolean {
  return reorderedSiblingIds(tree, node, offset) !== null;
}

// A folder and all folders below it: invalid targets when moving that folder.
export function folderAndDescendantIds(folder: FolderNode): Set<string> {
  const out = new Set<string>([folder.id]);
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === "folder") {
        out.add(n.id);
        walk(n.children);
      }
    }
  };
  walk(folder.children);
  return out;
}

// Every folder in display order with its depth, for the "Move to…" picker.
export function flattenFolders(tree: Tree): { folder: FolderNode; depth: number }[] {
  const out: { folder: FolderNode; depth: number }[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === "folder") {
        out.push({ folder: n, depth });
        walk(n.children, depth + 1);
      }
    }
  };
  walk(tree.root, 0);
  return out;
}
