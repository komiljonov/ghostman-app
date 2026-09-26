import { createContext, useContext } from "solid-js";
import { session } from "../wailsjs/go/models";
import { Tree, TreeNode } from "./tree";

// Shared by every row of the sidebar tree, so rows don't need long prop chains.
export interface TreeCtx {
  projectId: () => string;
  tree: () => Tree; // plain lookup maps from the last fetch (ids → nodes)
  isExpanded: (folderId: string) => boolean;
  toggle: (folderId: string) => void;
  expand: (folderId: string) => void;
  reload: () => Promise<void>;
  renamingId: () => string | undefined;
  setRenamingId: (id: string | undefined) => void;
  selectedRequestId: () => string | undefined;
  openRequest: (id: string) => void;
  askMove: (node: TreeNode) => void;
  askDelete: (node: TreeNode) => void;
  // Creates "New folder"/"New request" inside parentId ("" = root) and starts renaming it.
  create: (kind: "folder" | "request", parentId: string) => Promise<session.Problem | undefined>;
}

export const TreeContext = createContext<TreeCtx>();

export function useTree(): TreeCtx {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("useTree outside <TreeContext.Provider>");
  return ctx;
}
