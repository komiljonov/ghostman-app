import { createEffect, createSignal, on, Show } from "solid-js";
import { RenameExample } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";
import { handleProblem } from "../authStore";
import { examplesChangedFor } from "../examplesStore";
import { statusChip } from "../historyModel";
import { useTree } from "../treeContext";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import Icon from "./Icon";

interface Props {
  example: api.ExampleSummary;
  requestId: string;
  depth: number; // the example row's own depth (its request's + 1)
}

const INDENT = 16;

// A saved response example under its request in the sidebar tree: a leaf row —
// example icon · name · status chip · ⋯. Click (or Enter) opens the request's tab
// on its Examples sub-tab with this example selected; the menu has Open, Rename
// (inline) and Delete (confirm). NOT an li.tree-item: tree drag-and-drop reads
// only those rows, so an example is never dragged nor a drop target (reorder
// stays in the sub-tab).
export default function TreeExampleItem(props: Props) {
  const tree = useTree();
  const [draft, setDraft] = createSignal("");
  const id = () => props.example.id;
  const renaming = () => tree.renamingId() === id();
  const selected = () => tree.selectedId() === id();
  const menuAt = () => {
    const m = tree.menu();
    return m && m.id === id() ? m : undefined;
  };
  const chip = () => statusChip({ status: props.example.status, error: "" });

  const rename = createAction(async (name: string) => {
    const r = await RenameExample(id(), name);
    handleProblem(r.error);
    return r;
  });
  createEffect(on(renaming, (r) => {
    if (!r) return;
    setDraft(props.example.name);
    rename.setError(undefined);
  }));
  const submitRename = async () => {
    if (!renaming() || rename.pending()) return;
    const name = draft().trim();
    if (!name || name === props.example.name) {
      tree.setRenamingId(undefined);
      return;
    }
    const result = await rename.run(name);
    if (result && !result.error) {
      tree.setRenamingId(undefined);
      await examplesChangedFor(props.requestId); // these rows, the badge, open panels
    }
  };

  const open = () => tree.openExample(props.requestId, id());
  const menuItems = (): MenuEntry[] => [
    { label: "Open", onSelect: open },
    { label: "Rename", icon: "pencil", hint: "Ctrl+E", onSelect: () => tree.setRenamingId(id()) },
    "separator",
    { label: "Delete", icon: "trash", hint: "Del", danger: true, onSelect: () => tree.askDeleteExample(props.requestId, props.example) },
  ];

  return (
    <li class="tree-example" role="treeitem" id={`tree-row-${id()}`} aria-selected={selected()} data-example-id={id()}>
      <div classList={{ "tree-row": true, selected: selected(), "menu-open": !!menuAt() }}
        style={{ "padding-left": `${4 + props.depth * INDENT}px` }}
        onClick={() => {
          if (renaming()) return;
          tree.select(id());
          open();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          tree.openMenu(id(), e.clientX, e.clientY);
        }}>
        <span class="tree-lead tree-example-icon" aria-hidden="true"><Icon name="example" size={14} /></span>
        <Show when={renaming()} fallback={<span class="tree-label" title={props.example.name}>{props.example.name}</span>}>
          <input class="tree-rename" aria-label="New name" value={draft()} disabled={rename.pending()} maxLength={100}
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
        <span class={`history-status tree-example-status st-${chip().cls}`} title={`Status ${props.example.status}`}>{chip().text}</span>
        <button type="button" class="row-menu-trigger" aria-label={`Actions for ${props.example.name}`} tabIndex={-1}
          aria-haspopup="menu" aria-expanded={!!menuAt()}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            if (e.detail === 0) tree.openMenu(id(), r.left, r.bottom);
            else tree.openMenu(id(), e.clientX, e.clientY);
          }}>
          <Icon name="dots" />
        </button>
      </div>
      <Show when={menuAt()}>
        {(m) => (
          <ContextMenu x={m().x} y={m().y} label={`Actions for ${props.example.name}`} items={menuItems()}
            onClose={() => {
              tree.closeMenu();
              tree.focusTree();
            }} />
        )}
      </Show>
      <Show when={rename.error()}>
        <p class="tree-error" style={{ "margin-left": `${40 + props.depth * INDENT}px` }}>{rename.error()}</p>
      </Show>
    </li>
  );
}
