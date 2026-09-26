import { createSignal, Show } from "solid-js";
import { DeleteProject, MoveProject, UpdateProjectName } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";
import ConfirmButton from "./ConfirmButton";
import FormError from "./FormError";

interface Props {
  teamId: string;
  project: api.ProjectSummary;
  isMine: boolean;
  canManage: boolean; // team owner or project owner: rename + delete
  canEditAccess: boolean; // team owner
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: () => void;
  onEditAccess: () => void;
  onChanged: () => void;
}

export default function ProjectRow(props: Props) {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const rename = createAction(UpdateProjectName);
  const move = createAction(MoveProject);

  const submitRename = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await rename.run(props.project.id, name());
    if (result && !result.error) {
      setEditing(false);
      props.onChanged();
    }
  };

  const doMove = async (offset: number) => {
    const result = await move.run(props.teamId, props.project.id, offset);
    if (result && !result.error) props.onChanged();
  };

  return (
    <li class="row-item project-row">
      <Show when={editing()} fallback={
        <>
          <button type="button" class="link project-name" onClick={() => props.onOpen()}>{props.project.name}</button>
          <Show when={props.isMine}><span class="badge">yours</span></Show>
          <span class="row-spacer" />
          <Show when={move.error()}><span class="inline-error">{move.error()}</span></Show>
          <Show when={props.canMoveUp || props.canMoveDown}>
            <button type="button" class="small-button" title="Move up" aria-label="Move up"
              disabled={!props.canMoveUp || move.pending()} onClick={() => doMove(-1)}>↑</button>
            <button type="button" class="small-button" title="Move down" aria-label="Move down"
              disabled={!props.canMoveDown || move.pending()} onClick={() => doMove(1)}>↓</button>
          </Show>
          <Show when={props.canEditAccess}>
            <button type="button" class="small-button" onClick={() => props.onEditAccess()}>Access</button>
          </Show>
          <Show when={props.canManage}>
            <button type="button" class="small-button" onClick={() => {
              setName(props.project.name);
              rename.setError(undefined);
              setEditing(true);
            }}>Rename</button>
            <ConfirmButton
              label="Delete"
              prompt={`Delete project "${props.project.name}"?`}
              confirmLabel="Delete project"
              action={() => DeleteProject(props.project.id)}
              onDone={props.onChanged}
            />
          </Show>
        </>
      }>
        <form class="inline-form grow" onSubmit={submitRename}>
          <input type="text" aria-label="Project name" autofocus value={name()} disabled={rename.pending()}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
          <button class="primary small-button" type="submit" disabled={rename.pending()}>
            {rename.pending() ? "Saving…" : "Save"}
          </button>
          <button type="button" class="small-button" onClick={() => setEditing(false)}>Cancel</button>
          <FormError message={rename.error()} />
        </form>
      </Show>
    </li>
  );
}
