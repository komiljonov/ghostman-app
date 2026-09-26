import { createSignal, For, Show } from "solid-js";
import {
  RenameFolder, ReorderFolders, ReorderRequests, UpdateRequest,
} from "../../wailsjs/go/main/App";
import { api, session } from "../../wailsjs/go/models";
import { createAction } from "../action";
import { canMove, reorderedSiblingIds, TreeNode } from "../tree";
import { useTree } from "../treeContext";
import Dropdown from "./Dropdown";
import MethodBadge from "./MethodBadge";

interface Props {
  node: TreeNode;
  depth: number;
}

// One row of the sidebar tree (folder or request). Folders render their children
// only while expanded; expansion is per-node state, so toggling never rebuilds the tree.
export default function TreeItem(props: Props) {
  const tree = useTree();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const isFolder = () => props.node.kind === "folder";
  const expanded = () => isFolder() && tree.isExpanded(props.node.id);
  const renaming = () => tree.renamingId() === props.node.id;

  const rename = createAction(async (name: string) =>
    isFolder()
      ? RenameFolder(props.node.id, name)
      : UpdateRequest(props.node.id, api.RequestPatch.createFrom({ name })),
  );
  const move = createAction(async (offset: -1 | 1): Promise<{ error?: session.Problem }> => {
    // Look the node up in the plain tree: the reorder endpoints need the full sibling list.
    const node = isFolder() ? tree.tree().folders.get(props.node.id) : tree.tree().requests.get(props.node.id);
    const ids = node ? reorderedSiblingIds(tree.tree(), node, offset) : null;
    if (!node || !ids) return {};
    return node.kind === "folder"
      ? ReorderFolders(tree.projectId(), node.parentId ?? "", ids)
      : ReorderRequests(tree.projectId(), node.folderId ?? "", ids);
  });
  const [createError, setCreateError] = createSignal<string>();
  const error = () => rename.error() || move.error() || createError();

  const lookup = () => (isFolder() ? tree.tree().folders.get(props.node.id) : tree.tree().requests.get(props.node.id));
  const movable = (offset: -1 | 1) => {
    const node = lookup();
    return node ? canMove(tree.tree(), node, offset) : false;
  };

  const startRename = () => {
    setDraft(props.node.name);
    rename.setError(undefined);
    tree.setRenamingId(props.node.id);
  };
  const submitRename = async () => {
    // Enter/Escape remove the input, which fires blur again: only the first call counts.
    if (!renaming() || rename.pending()) return;
    const name = draft().trim();
    if (!name || name === props.node.name) {
      tree.setRenamingId(undefined);
      return;
    }
    const result = await rename.run(name);
    if (result && !result.error) {
      tree.setRenamingId(undefined);
      await tree.reload();
    }
  };
  const doMove = async (offset: -1 | 1) => {
    const result = await move.run(offset);
    if (result && !result.error) await tree.reload();
  };
  const createInside = async (kind: "folder" | "request") => {
    setCreateError((await tree.create(kind, props.node.id))?.message);
  };

  const onRowClick = () => {
    if (renaming()) return;
    if (isFolder()) tree.toggle(props.node.id);
    else tree.openRequest(props.node.id);
  };

  return (
    <li class="tree-item" role="treeitem" aria-expanded={isFolder() ? expanded() : undefined}>
      <div
        classList={{ "tree-row": true, selected: !isFolder() && tree.selectedRequestId() === props.node.id }}
        style={{ "padding-left": `${6 + props.depth * 14}px` }}
        onClick={onRowClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        <Show when={isFolder()} fallback={<MethodBadge method={(props.node as { method: string }).method} />}>
          <span class="chevron" aria-hidden="true">{expanded() ? "▾" : "▸"}</span>
          <span class="folder-icon" aria-hidden="true">▣</span>
        </Show>
        <Show when={renaming()} fallback={<span class="tree-label" title={props.node.name}>{props.node.name}</span>}>
          <input class="tree-rename" aria-label="New name" value={draft()} autofocus disabled={rename.pending()}
            ref={(el) => queueMicrotask(() => el.select())}
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename();
              if (e.key === "Escape") tree.setRenamingId(undefined);
            }}
            onBlur={() => void submitRename()} />
        </Show>
        <div class="row-menu" onClick={(e) => e.stopPropagation()}>
          <Dropdown triggerLabel={`Actions for ${props.node.name}`} triggerClass="row-menu-trigger" align="right"
            open={menuOpen()} onOpenChange={setMenuOpen} trigger={<span>⋯</span>}>
            {(close) => {
              const item = (fn: () => void) => () => {
                close();
                fn();
              };
              return (
                <>
                  <Show when={isFolder()}>
                    <button type="button" role="menuitem" class="menu-item" onClick={item(() => void createInside("folder"))}>New folder inside</button>
                    <button type="button" role="menuitem" class="menu-item" onClick={item(() => void createInside("request"))}>New request inside</button>
                    <div class="menu-divider" />
                  </Show>
                  <button type="button" role="menuitem" class="menu-item" onClick={item(startRename)}>Rename</button>
                  <button type="button" role="menuitem" class="menu-item" onClick={item(() => tree.askMove(props.node))}>Move to…</button>
                  <button type="button" role="menuitem" class="menu-item" disabled={!movable(-1)} onClick={item(() => void doMove(-1))}>Move up</button>
                  <button type="button" role="menuitem" class="menu-item" disabled={!movable(1)} onClick={item(() => void doMove(1))}>Move down</button>
                  <div class="menu-divider" />
                  <button type="button" role="menuitem" class="menu-item danger-text" onClick={item(() => tree.askDelete(props.node))}>Delete</button>
                </>
              );
            }}
          </Dropdown>
        </div>
      </div>
      <Show when={error()}>
        <p class="tree-error" style={{ "margin-left": `${20 + props.depth * 14}px` }}>{error()}</p>
      </Show>
      <Show when={expanded()}>
        <ul class="tree-children" role="group">
          <For each={(props.node as { children: TreeNode[] }).children}>
            {(child) => <TreeItem node={child} depth={props.depth + 1} />}
          </For>
          <Show when={(props.node as { children: TreeNode[] }).children.length === 0}>
            <li class="tree-empty" style={{ "padding-left": `${26 + (props.depth + 1) * 14}px` }}>Empty folder</li>
          </Show>
        </ul>
      </Show>
    </li>
  );
}
