import { createSignal, Match, onMount, Switch } from "solid-js";
import { PrepareExample, SaveExample } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import { createSaveFlow, EXAMPLE_SYNC_NOTICE, SaveDialogState } from "../examplesModel";
import { examplesChanged, refreshExampleCount } from "../examplesStore";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  source: main.ExampleSource; // the tab's active response, or a history entry
  onSaved: (name: string) => void; // the caller shows the inline confirmation
  onClose: () => void;
}

// "Save as example": Go prepares it (the default name "<status> response", or a
// refusal — over the 1 MB example cap, nothing to save), the user names it, Go
// saves status + headers + content type + the FULL body. The honest notice:
// examples sync to the team, and nothing is scrubbed.
export default function SaveExampleDialog(props: Props) {
  const [state, setState] = createSignal<SaveDialogState>({ kind: "preparing" });
  let requestId = ""; // the request the example is saved to (Go's prepare says which)
  const flow = createSaveFlow({
    prepare: async () => {
      const r = await PrepareExample(props.source);
      handleProblem(r.error);
      requestId = r.data?.request_id ?? "";
      return { data: r.data ?? undefined, error: r.error };
    },
    save: async (name) => {
      const r = await SaveExample(props.source, name);
      handleProblem(r.error);
      return { data: r.data ?? undefined, error: r.error };
    },
    onSaved: (e) => {
      examplesChanged();
      if (requestId) void refreshExampleCount(requestId); // the "Examples (N)" badge
      props.onSaved(e.name);
      props.onClose();
    },
  }, setState);
  onMount(() => void flow.start());

  return (
    <Modal title="Save as example" onClose={props.onClose} class="save-example-dialog">
      <Switch>
        <Match when={state().kind === "preparing"}>
          <p class="muted small">Reading the response…</p>
        </Match>
        <Match when={state().kind === "refused" && (state() as Extract<SaveDialogState, { kind: "refused" }>)}>
          {(s) => (
            <>
              <p class="form-error" role="alert">{s().message}</p>
              <div class="modal-actions">
                <button type="button" onClick={() => props.onClose()}>Close</button>
              </div>
            </>
          )}
        </Match>
        <Match when={state().kind === "ready" && (state() as Extract<SaveDialogState, { kind: "ready" }>)}>
          {(s) => (
            <form onSubmit={(e) => {
              e.preventDefault();
              void flow.save();
            }}>
              <label class="field">
                <span>Name</span>
                <input type="text" value={s().name} maxLength={100} aria-label="Example name"
                  ref={(el) => queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })}
                  onInput={(e) => flow.setName(e.currentTarget.value)} />
              </label>
              <p class="muted small save-example-notice">{EXAMPLE_SYNC_NOTICE}</p>
              <FormError message={s().error} />
              <div class="modal-actions">
                <button type="button" onClick={() => props.onClose()}>Cancel</button>
                <button type="submit" class="primary" disabled={s().saving || s().name.trim() === ""}>{s().saving ? "Saving…" : "Save example"}</button>
              </div>
            </form>
          )}
        </Match>
      </Switch>
    </Modal>
  );
}
