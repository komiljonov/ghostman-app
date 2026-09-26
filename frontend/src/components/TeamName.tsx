import { createSignal, Show } from "solid-js";
import { UpdateTeamName } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";
import FormError from "./FormError";

interface Props {
  team: api.Team;
  onRenamed: () => void;
}

// Team heading; owners get an inline rename.
export default function TeamName(props: Props) {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const rename = createAction(UpdateTeamName);

  const startEditing = () => {
    setName(props.team.name);
    rename.setError(undefined);
    setEditing(true);
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await rename.run(props.team.id, name());
    if (result && !result.error) {
      setEditing(false);
      props.onRenamed();
    }
  };

  return (
    <Show when={editing()} fallback={
      <div class="team-title">
        <h2>{props.team.name}</h2>
        <Show when={props.team.is_owner}>
          <span class="badge">owner</span>
          <button type="button" class="link" onClick={startEditing}>Rename</button>
        </Show>
      </div>
    }>
      <form class="inline-form" onSubmit={submit}>
        <input type="text" aria-label="Team name" autofocus value={name()}
          onInput={(e) => setName(e.currentTarget.value)} disabled={rename.pending()}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
        <button class="primary" type="submit" disabled={rename.pending()}>
          {rename.pending() ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        <FormError message={rename.error()} />
      </form>
    </Show>
  );
}
