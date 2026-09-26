import { createSignal, Show } from "solid-js";
import { CreateProject } from "../../wailsjs/go/main/App";
import { createAction } from "../action";
import FormError from "./FormError";

interface Props {
  teamId: string;
  onCreated: () => void;
}

export default function NewProjectForm(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const create = createAction(CreateProject);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await create.run(props.teamId, name());
    if (result?.data) {
      setName("");
      setOpen(false);
      props.onCreated();
    }
  };

  return (
    <Show when={open()} fallback={
      <button type="button" class="new-team" onClick={() => setOpen(true)}>+ New project</button>
    }>
      <form class="inline-form" onSubmit={submit}>
        <input type="text" placeholder="Project name" aria-label="Project name" autofocus value={name()}
          disabled={create.pending()} onInput={(e) => setName(e.currentTarget.value)} />
        <button class="primary" type="submit" disabled={create.pending()}>
          {create.pending() ? "Creating…" : "Create"}
        </button>
        <button type="button" onClick={() => {
          setOpen(false);
          create.setError(undefined);
        }}>Cancel</button>
        <FormError message={create.error()} />
      </form>
    </Show>
  );
}
