import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
  RenameFolder, ReorderFolders, ReorderRequests, UpdateRequest,
} from "../../wailsjs/go/main/App";
import { api, session } from "../../wailsjs/go/models";
import { createAction } from "../action";
import { canMove, reorderedSiblingIds, TreeNode } from "../tree";
import { useTree } from "../treeContext";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import Icon from "./Icon";
import MethodBadge from "./MethodBadge";

interface Props {
  node: TreeNode;
  depth: number;
}

// Indentation per depth level, in px (the CSS grid: 16 px chevron + 16 px icon).
const INDENT = 16;

// One row of the sidebar tree (folder or request). Folders render their children
// only while expanded; expansion is per-node state, so toggling never rebuilds the
// tree. Row layout: indent · chevron (folders) · folder icon or method badge ·
// name · ⋯. Right-click or ⋯ opens the shared context menu.
export default function TreeItem(props: Props) {
  const tree = useTree();
  const [draft, setDraft] = createSignal("");

  const isFolder = () => props.node.kind === "folder";
  const expanded = () => isFolder() && tree.isExpanded(props.node.id);
  const renaming = () => tree.renamingId() === props.node.id;
  const selected = () => tree.selectedId() === props.node.id;
  const menuAt = () => {
    const m = tree.menu();
    return m && m.id === props.node.id ? m : undefined;
  };

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

  // However renaming starts (menu, Ctrl+E, a freshly created node), begin from the name.
  createEffect(on(renaming, (r) => {
    if (!r) return;
    setDraft(props.node.name);
    rename.setError(undefined);
  }));

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
    if (tree.consumeDragClick() || renaming()) return;
    tree.select(props.node.id);
    if (isFolder()) tree.toggle(props.node.id);
    else tree.openRequest(props.node.id);
  };

  const menuItems = (): MenuEntry[] => {
    const node = props.node;
    const items: MenuEntry[] = [];
    if (isFolder()) {
      items.push(
        { label: "New folder inside", icon: "folder", onSelect: () => void createInside("folder") },
        { label: "New request inside", icon: "plus", onSelect: () => void createInside("request") },
        "separator",
        { label: "Settings…", icon: "settings", onSelect: () => tree.askFolderSettings(node.id) },
      );
    }
    items.push({ label: "Rename", icon: "pencil", hint: "Ctrl+E", onSelect: () => tree.setRenamingId(node.id) });
    if (!isFolder()) {
      items.push({ label: "Duplicate", icon: "duplicate", hint: "Ctrl+D", onSelect: () => void tree.duplicate(node.id) });
    }
    items.push(
      "separator",
      { label: "Move to…", onSelect: () => tree.askMove(node) },
      { label: "Move up", disabled: !movable(-1), onSelect: () => void doMove(-1) },
      { label: "Move down", disabled: !movable(1), onSelect: () => void doMove(1) },
      "separator",
      { label: "Delete", icon: "trash", hint: "Del", danger: true, onSelect: () => tree.askDelete(node) },
    );
    return items;
  };

  return (
    <li class="tree-item" role="treeitem" id={`tree-row-${props.node.id}`} aria-selected={selected()}
      aria-expanded={isFolder() ? expanded() : undefined}
      data-id={props.node.id} data-kind={props.node.kind} data-depth={props.depth} data-expanded={String(expanded())}
      data-parent={(isFolder() ? (props.node as { parentId: string | null }).parentId : (props.node as { folderId: string | null }).folderId) ?? ""}
      data-name={props.node.name} data-method={isFolder() ? "" : (props.node as { method: string }).method}>
      <div
        classList={{
          "tree-row": true, selected: selected(), "menu-open": !!menuAt(),
          "drag-source": tree.draggingId() === props.node.id, "drop-into": tree.dropIntoId() === props.node.id,
        }}
        style={{ "padding-left": `${4 + props.depth * INDENT}px` }}
        onClick={onRowClick}
        onContextMenu={(e) => {
          e.preventDefault();
          tree.openMenu(props.node.id, e.clientX, e.clientY);
        }}
      >
        <span class="tree-lead" aria-hidden="true">
          <Show when={isFolder()} fallback={<MethodBadge method={(props.node as { method: string }).method} />}>
            <span classList={{ "tree-chevron": true, open: expanded() }}><Icon name="chevron" size={14} /></span>
            <span class="tree-folder"><Icon name={expanded() ? "folder-open" : "folder"} /></span>
          </Show>
        </span>
        <Show when={renaming()} fallback={<span class="tree-label" title={props.node.name}>{props.node.name}</span>}>
          <input class="tree-rename" aria-label="New name" value={draft()} disabled={rename.pending()}
            ref={(el) => queueMicrotask(() => {
              el.focus();
              el.select();
            })}
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename().then(tree.focusTree);
              if (e.key === "Escape") {
                tree.setRenamingId(undefined);
                tree.focusTree();
              }
            }}
            onBlur={() => void submitRename()} />
        </Show>
        <button type="button" class="row-menu-trigger" aria-label={`Actions for ${props.node.name}`} tabIndex={-1}
          aria-haspopup="menu" aria-expanded={!!menuAt()}
          onClick={(e) => {
            e.stopPropagation();
            // At the pointer; from the keyboard (no pointer) under the button.
            const r = e.currentTarget.getBoundingClientRect();
            if (e.detail === 0) tree.openMenu(props.node.id, r.left, r.bottom);
            else tree.openMenu(props.node.id, e.clientX, e.clientY);
          }}>
          <Icon name="dots" />
        </button>
      </div>
      <Show when={menuAt()}>
        {(m) => (
          <ContextMenu x={m().x} y={m().y} label={`Actions for ${props.node.name}`} items={menuItems()}
            onClose={() => {
              tree.closeMenu();
              tree.focusTree();
            }} />
        )}
      </Show>
      <Show when={error()}>
        <p class="tree-error" style={{ "margin-left": `${40 + props.depth * INDENT}px` }}>{error()}</p>
      </Show>
      <Show when={expanded()}>
        <ul class="tree-children" role="group">
          <For each={(props.node as { children: TreeNode[] }).children}>
            {(child) => <TreeItem node={child} depth={props.depth + 1} />}
          </For>
          <Show when={(props.node as { children: TreeNode[] }).children.length === 0}>
            <li class="tree-empty" style={{ "padding-left": `${40 + (props.depth + 1) * INDENT}px` }}>Empty folder</li>
          </Show>
        </ul>
      </Show>
    </li>
  );
}
