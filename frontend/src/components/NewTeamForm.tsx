import { createSignal, Show } from "solid-js";
import { CreateTeam } from "../../wailsjs/go/main/App";
import { createAction } from "../action";
import FormError from "./FormError";

interface Props {
  onCreated: (id: string) => void;
}

export default function NewTeamForm(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const create = createAction(CreateTeam);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await create.run(name());
    if (result?.data) {
      setName("");
      setOpen(false);
      props.onCreated(result.data.id);
    }
  };

  return (
    <Show when={open()} fallback={
      <button type="button" class="new-team" onClick={() => setOpen(true)}>+ New team</button>
    }>
      <form class="inline-form stacked" onSubmit={submit}>
        <input type="text" placeholder="Team name" autofocus value={name()}
          onInput={(e) => setName(e.currentTarget.value)} disabled={create.pending()} />
        <div class="row">
          <button class="primary" type="submit" disabled={create.pending()}>
            {create.pending() ? "Creating…" : "Create"}
          </button>
          <button type="button" onClick={() => {
            setOpen(false);
            create.setError(undefined);
          }}>Cancel</button>
        </div>
        <FormError message={create.error()} />
      </form>
    </Show>
  );
}
