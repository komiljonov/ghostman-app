import { createSignal, Show } from "solid-js";
import { DeleteEnvironment, MoveEnvironment, RenameEnvironment } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  projectId: string;
  env: api.Environment;
  selected: boolean;
  active: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onChanged: () => void;
}

// One environment in the manage view's list: select, rename inline, reorder, delete.
export default function EnvironmentItem(props: Props) {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const rename = createAction(RenameEnvironment);
  const move = createAction(MoveEnvironment);

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

  const doMove = async (offset: number) => {
    const result = await move.run(props.projectId, props.env.id, offset);
    if (result && !result.error) props.onChanged();
  };

  return (
    <li classList={{ "env-item": true, selected: props.selected }}>
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
        }}>✎</button>
        <button type="button" class="small-button" title="Move up" aria-label="Move up" disabled={props.first || move.pending()}
          onClick={() => void doMove(-1)}>↑</button>
        <button type="button" class="small-button" title="Move down" aria-label="Move down" disabled={props.last || move.pending()}
          onClick={() => void doMove(1)}>↓</button>
        <button type="button" class="icon-button" title="Delete" aria-label={`Delete ${props.env.name}`}
          onClick={() => setConfirmDelete(true)}>×</button>
      </div>
      <Show when={rename.error() || move.error()}><p class="inline-error">{rename.error() || move.error()}</p></Show>
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
