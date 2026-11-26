import { createResource, createSignal, For, Show } from "solid-js";
import { CreateMissingVariables, MissingVariables } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { chosenKeys, createLabel, emptyText, initialSelection, resultLines, toggleAll, toggleKey } from "../missingVars";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  projectId: string;
  envId: string;
  envName: string;
  onCreated: () => void; // re-fetch the table and the env context
  onClose: () => void;
}

// The keys this project's requests / folders / scripts use that the environment
// lacks (Go: MissingVariables), all checked; Create makes the chosen ones regular
// variables with "" through the normal paths. Works any time (drift fixer).
export default function MissingVariablesModal(props: Props) {
  const [sel, setSel] = createSignal(new Set<string>());
  const [result] = createResource(() => ({ p: props.projectId, e: props.envId }), async (src) => {
    const r = await MissingVariables(src.p, src.e);
    handleProblem(r.error);
    setSel(initialSelection(r.data ?? []));
    return r;
  });
  const keys = () => result()?.data ?? [];
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [failures, setFailures] = createSignal<string[]>([]);

  const create = async () => {
    const chosen = chosenKeys(sel(), keys());
    if (chosen.length === 0) return;
    setBusy(true);
    setError(undefined);
    const r = await CreateMissingVariables(props.envId, chosen);
    setBusy(false);
    handleProblem(r.error);
    if (r.error || !r.data) {
      setError(r.error?.message ?? "could not create the variables");
      return;
    }
    const lines = resultLines(r.data);
    if (r.data.created.length > 0) props.onCreated();
    if (lines.errors.length > 0) {
      setFailures(lines.errors);
      return; // keep the dialog open to show what failed
    }
    props.onClose();
  };

  return (
    <Modal title="Add missing variables" class="missing-vars-modal" onClose={props.onClose}>
      <p class="muted small">
        Variables used as <code>{"{{KEY}}"}</code> in this project's requests, folders and scripts but not defined
        in <strong>{props.envName}</strong>. They are created as regular variables with an empty value.
      </p>
      <Show when={!result.loading} fallback={<p class="placeholder">Looking for missing variables…</p>}>
        <Show when={!result()?.error} fallback={<p class="form-error">{result()?.error?.message}</p>}>
          <Show when={keys().length > 0} fallback={<p class="missing-vars-empty">{emptyText(props.envName)}</p>}>
            <label class="choice missing-vars-all">
              <input type="checkbox" checked={keys().every((k) => sel().has(k))}
                onChange={() => setSel(toggleAll(sel(), keys()))} />
              Select all ({keys().length})
            </label>
            <ul class="missing-vars-list">
              <For each={keys()}>
                {(k) => (
                  <li>
                    <label class="choice">
                      <input type="checkbox" checked={sel().has(k)} onChange={() => setSel(toggleKey(sel(), k))} />
                      <code>{k}</code>
                    </label>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
      <FormError message={error()} />
      <Show when={failures().length > 0}>
        <ul class="form-error missing-vars-failures"><For each={failures()}>{(f) => <li>{f}</li>}</For></ul>
      </Show>
      <div class="modal-actions">
        <button type="button" onClick={() => props.onClose()}>{keys().length === 0 ? "Close" : "Cancel"}</button>
        <Show when={keys().length > 0}>
          <button type="button" class="primary" disabled={busy() || chosenKeys(sel(), keys()).length === 0} onClick={() => void create()}>
            {busy() ? "Creating…" : createLabel(chosenKeys(sel(), keys()).length)}
          </button>
        </Show>
      </div>
    </Modal>
  );
}
