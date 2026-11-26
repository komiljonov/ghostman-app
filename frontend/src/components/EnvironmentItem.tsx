import { createSignal, Show } from "solid-js";
import { DeleteEnvironment, RenameEnvironment } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";
import ConfirmDialog from "./ConfirmDialog";
import Icon from "./Icon";

interface Props {
  projectId: string;
  env: api.Environment;
  selected: boolean;
  active: boolean;
  dragging: boolean; // being dragged (EnvListView's row drag)
  onSelect: () => void;
  onChanged: () => void;
}

// One environment in the manage view's list: select, rename inline, delete; the row
// itself drags to reorder (EnvListView).
export default function EnvironmentItem(props: Props) {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const rename = createAction(RenameEnvironment);

  const submit = async () => {
    const next = name().trim();
    if (!next || next === props.env.name) {
      setEditing(false);
      return;
    }
    const result = await rename.run(props.env.id, next);
    if (result && !result.error) {
      setEditing(false);
      props.onChanged();
    }
  };

  return (
    <li classList={{ "env-item": true, selected: props.selected, "drag-source": props.dragging }} data-drag-id={props.env.id}>
      <Show when={editing()} fallback={
        <button type="button" class="env-name" onClick={() => props.onSelect()}>
          {props.env.name}
          <Show when={props.active}><span class="badge">active</span></Show>
        </button>
      }>
        <input type="text" class="env-rename" aria-label="Environment name" value={name()} autofocus
          disabled={rename.pending()} onInput={(e) => setName(e.currentTarget.value)}
          onBlur={() => void submit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") setEditing(false);
          }} />
      </Show>
      <div class="env-actions">
        <button type="button" class="small-button" title="Rename" aria-label={`Rename ${props.env.name}`} onClick={() => {
          setName(props.env.name);
          rename.setError(undefined);
          setEditing(true);
        }}><Icon name="pencil" size={14} /></button>
        <button type="button" class="icon-button" title="Delete" aria-label={`Delete ${props.env.name}`}
          onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} /></button>
      </div>
      <Show when={rename.error()}><p class="inline-error">{rename.error()}</p></Show>
      <Show when={confirmDelete()}>
        <ConfirmDialog
          title="Delete environment"
          message={`Delete "${props.env.name}" and all its variables for everyone? The secret values stored on this machine for it are removed too.`}
          confirmLabel="Delete environment"
          action={() => DeleteEnvironment(props.projectId, props.env.id)}
          onDone={props.onChanged}
          onClose={() => setConfirmDelete(false)}
        />
      </Show>
    </li>
  );
}
