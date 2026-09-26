import { createSignal, Show } from "solid-js";
import { session } from "../../wailsjs/go/models";
import { createAction } from "../action";
import FormError from "./FormError";

interface Props {
  label: string; // e.g. "+ New team"
  placeholder: string;
  create: (name: string) => Promise<{ data?: { id: string } | null; error?: session.Problem }>;
  onCreated: (id: string) => void;
}

// "+ New …" button that expands into a one-field name form (used in the switchers).
export default function InlineCreateForm(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const create = createAction((n: string) => props.create(n));

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
      <button type="button" class="menu-item accent" onClick={() => setOpen(true)}>{props.label}</button>
    }>
      <form class="menu-form" onSubmit={submit}>
        <input type="text" placeholder={props.placeholder} aria-label={props.placeholder} autofocus value={name()}
          disabled={create.pending()} onInput={(e) => setName(e.currentTarget.value)} />
        <div class="row">
          <button class="primary small-button" type="submit" disabled={create.pending()}>
            {create.pending() ? "Creating…" : "Create"}
          </button>
          <button type="button" class="small-button" onClick={() => {
            setOpen(false);
            create.setError(undefined);
          }}>Cancel</button>
        </div>
        <FormError message={create.error()} />
      </form>
    </Show>
  );
}
