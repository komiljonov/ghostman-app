import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
  CreateFolder, CreateRequest, DuplicateRequest, GetTreeState, ListFolders, ListRequests, SetTreeState,
} from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { buildTree, Tree, TreeNode } from "../tree";
import { duplicateAndOpen } from "../treeActions";
import { TreeContext, TreeCtx } from "../treeContext";
import { canUseTreeKeys, navigate, shortcutApplies, treeShortcut, visibleRows } from "../treeNav";
import Dropdown from "./Dropdown";
import FormError from "./FormError";
import Icon from "./Icon";
import TreeItem from "./TreeItem";
import MoveToModal from "./MoveToModal";
import DeleteNodeModal from "./DeleteNodeModal";

interface Props {
  projectId: string;
  refreshTick: number;
  selectedRequestId: string | undefined;
  onOpenRequest: (id: string) => void;
  // After every successful load: lets open tabs follow renames and deletions.
  onLoaded: (projectId: string, requests: Map<string, { name: string }>) => void;
}

// Left sidebar: the current project's folders & requests. One ListFolders + one
// ListRequests per load; the tree is rebuilt from them after every mutation.
export default function ProjectTree(props: Props) {
  const emptyTree = (): Tree => ({ root: [], folders: new Map(), requests: new Map(), requestCount: 0 });
  const [lookup, setLookup] = createSignal<Tree>(emptyTree());
  // Rendered tree. reconcile keyed by id keeps unchanged nodes identical, so <For> only
  // touches rows that actually changed.
  const [view, setView] = createStore<{ root: TreeNode[] }>({ root: [] });
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({});
  const [loaded, setLoaded] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string>();
  const [rootError, setRootError] = createSignal<string>();
  const [renamingId, setRenamingId] = createSignal<string>();
  const [moving, setMoving] = createSignal<TreeNode>();
  const [deleting, setDeleting] = createSignal<TreeNode>();
  const [selectedId, setSelectedId] = createSignal<string>();
  const [menu, setMenu] = createSignal<{ id: string; x: number; y: number }>();
  let treeEl: HTMLUListElement | undefined;

  // The selection follows the active request tab (opening from anywhere selects it).
  createEffect(on(() => props.selectedRequestId, (id) => id && setSelectedId(id)));

  const nodeById = (id: string | undefined): TreeNode | undefined =>
    id ? lookup().folders.get(id) ?? lookup().requests.get(id) : undefined;

  const select = (id: string) => {
    setSelectedId(id);
    document.getElementById(`tree-row-${id}`)?.scrollIntoView({ block: "nearest" });
  };

  const reload = async () => {
    const projectId = props.projectId;
    const [folders, requests] = await Promise.all([ListFolders(projectId), ListRequests(projectId)]);
    if (projectId !== props.projectId) return; // switched project meanwhile
    const problem = folders.error ?? requests.error;
    handleProblem(problem);
    setLoadError(problem?.message);
    if (problem) return;
    const tree = buildTree(folders.data, requests.data);
    setLookup(tree);
    setView("root", reconcile(tree.root, { key: "id" }));
    setLoaded(true);
    // Forget expanded state of folders that no longer exist (deleted here or elsewhere).
    const stale = Object.keys(expanded).filter((id) => expanded[id] && !tree.folders.has(id));
    if (stale.length > 0) {
      for (const id of stale) setExpanded(id, undefined!);
      persistExpanded();
    }
    props.onLoaded(projectId, tree.requests);
  };

  const persistExpanded = () => {
    const ids = Object.keys(expanded).filter((id) => expanded[id]);
    void SetTreeState(props.projectId, ids);
  };

  // New project: restore its expanded folders (local UI state), then load the tree.
  // Memo: only a real project change (not a refreshed but equal id) resets the tree.
  const projectId = createMemo(() => props.projectId);
  createEffect(on(projectId, async (projectId) => {
    setLoaded(false);
    setRenamingId(undefined);
    setSelectedId(props.selectedRequestId);
    setMenu(undefined);
    setView("root", []);
    const ids = await GetTreeState(projectId);
    setExpanded(reconcile(Object.fromEntries(ids.map((id) => [id, true]))));
    await reload();
  }));
  createEffect(on(() => props.refreshTick, () => void reload(), { defer: true }));

  const ctx: TreeCtx = {
    projectId: () => props.projectId,
    tree: lookup,
    isExpanded: (id) => !!expanded[id],
    toggle: (id) => {
      setExpanded(id, (v) => !v);
      persistExpanded();
    },
    expand: (id) => {
      if (expanded[id]) return;
      setExpanded(id, true);
      persistExpanded();
    },
    reload,
    renamingId,
    setRenamingId,
    selectedId,
    select,
    focusTree: () => treeEl?.focus({ preventScroll: true }),
    menu,
    openMenu: (id, x, y) => {
      setSelectedId(id);
      setMenu({ id, x, y });
    },
    closeMenu: () => setMenu(undefined),
    duplicate: async (id) => {
      const problem = await duplicateAndOpen(id, {
        duplicate: DuplicateRequest,
        reload,
        select,
        open: props.onOpenRequest,
      });
      handleProblem(problem);
      setRootError(problem?.message);
    },
    openRequest: props.onOpenRequest,
    askMove: setMoving,
    askDelete: setDeleting,
    create: async (kind, parentId) => {
      const result = kind === "folder"
        ? await CreateFolder(props.projectId, "New folder", parentId)
        : await CreateRequest(props.projectId, "New request", parentId);
      handleProblem(result.error);
      if (result.error || !result.data) return result.error;
      if (parentId) ctx.expand(parentId);
      await reload();
      setRenamingId(result.data.id);
      return undefined;
    },
  };

  const modalOpen = () => !!document.querySelector(".modal-backdrop");

  // Keyboard while the tree has focus: arrows/Home/End/Enter navigate, Ctrl+E
  // renames, Del deletes (with the usual confirm), Ctrl+D duplicates a request,
  // Shift+F10 / the menu key open the row menu. Never from the rename input.
  const onTreeKey = (e: KeyboardEvent) => {
    if (!canUseTreeKeys({ modalOpen: modalOpen(), renaming: !!renamingId(), target: e.target as HTMLElement })) return;
    const node = nodeById(selectedId());
    const shortcut = treeShortcut(e);
    if (shortcut) {
      e.preventDefault(); // Ctrl+D / Ctrl+E also mean something to the browser
      if (!node || !shortcutApplies(shortcut, node.kind)) return;
      if (shortcut === "rename") setRenamingId(node.id);
      else if (shortcut === "delete") setDeleting(node);
      else void ctx.duplicate(node.id);
      return;
    }
    if (node && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
      e.preventDefault();
      const r = document.getElementById(`tree-row-${node.id}`)?.getBoundingClientRect();
      if (r) ctx.openMenu(node.id, r.left + 24, r.bottom);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const move = navigate(visibleRows(view.root, ctx.isExpanded), selectedId(), e.key);
    if (!move) return;
    e.preventDefault();
    if (move.type === "select") select(move.id);
    else if (move.type === "expand") ctx.expand(move.id);
    else if (move.type === "collapse" || move.type === "toggle") ctx.toggle(move.id);
    else props.onOpenRequest(move.id);
  };

  const createAtRoot = async (kind: "folder" | "request") => {
    setRootError((await ctx.create(kind, ""))?.message);
  };

  return (
    <TreeContext.Provider value={ctx}>
      <nav class="sidebar tree-sidebar" aria-label="Project tree">
        <div class="tree-header">
          <span class="menu-heading">Requests</span>
          <Dropdown triggerLabel="New folder or request" triggerClass="row-menu-trigger add" trigger={<Icon name="plus" />}>
            {(close) => (
              <>
                <button type="button" role="menuitem" class="menu-item" onClick={() => {
                  close();
                  void createAtRoot("folder");
                }}>New folder</button>
                <button type="button" role="menuitem" class="menu-item" onClick={() => {
                  close();
                  void createAtRoot("request");
                }}>New request</button>
              </>
            )}
          </Dropdown>
        </div>
        <FormError message={rootError() || loadError()} />
        <Show when={loaded()} fallback={<Show when={!loadError()}><p class="placeholder small tree-note">Loading…</p></Show>}>
          <Show when={view.root.length > 0} fallback={<p class="placeholder small tree-note">No requests yet — create one</p>}>
            <ul class="tree" role="tree" aria-label="Folders and requests" tabIndex={0} ref={treeEl}
              aria-activedescendant={selectedId() && nodeById(selectedId()) ? `tree-row-${selectedId()}` : undefined}
              onKeyDown={onTreeKey}>
              <For each={view.root}>{(node) => <TreeItem node={node} depth={0} />}</For>
            </ul>
          </Show>
        </Show>
      </nav>
      <Show when={moving()}>
        {(node) => <MoveToModal node={node()} onClose={() => setMoving(undefined)} />}
      </Show>
      <Show when={deleting()}>
        {(node) => <DeleteNodeModal node={node()} onClose={() => setDeleting(undefined)} />}
      </Show>
    </TreeContext.Provider>
  );
}
