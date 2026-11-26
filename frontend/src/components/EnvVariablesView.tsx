import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { ListVariables } from "../../wailsjs/go/main/App";
import { envs } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import { envContext, refreshEnvContext } from "../envStore";
import NewVariableRow from "./NewVariableRow";
import VariableRow from "./VariableRow";

interface Props {
  envId: string;
}

// An environment tab: its variables table (key / type / value, secrets local-only,
// values autosaved). Rows flush pending edits when this view unmounts, i.e. when
// the tab is closed or another tab becomes active. Every fetch is reconciled into
// the rows BY ID, so a re-fetch after a rename / retype / create updates rows in
// place: no row remounts, and keyboard focus (Tab from a just-committed key) stays.
// Tab order per row: key → type → value → the next row's key (actions are mouse-only).
export default function EnvVariablesView(props: Props) {
  const [tick, setTick] = createSignal(0);
  const env = () => envContext()?.environments.find((e) => e.id === props.envId);

  const [variables] = createResource(() => ({ id: props.envId, tick: tick() }), async (src) => {
    const result = await ListVariables(src.id);
    handleProblem(result.error);
    return result;
  });

  const [rows, setRows] = createStore<envs.VariableView[]>([]);
  createEffect(() => {
    const data = variables()?.data;
    if (data) setRows(reconcile(data, { key: "id" }));
  });

  const structureChanged = () => {
    setTick((n) => n + 1);
    void refreshEnvContext();
  };

  return (
    <div class="env-manage">
      <div class="pane-kicker">Environment</div>
      <section class="env-vars">
        <div class="team-title">
          <h2>{env()?.name ?? "Environment"}</h2>
          <Show when={envContext()?.active_id === props.envId}><span class="badge">active</span></Show>
        </div>
        <p class="muted small">
          Use variables as <code>{"{{KEY}}"}</code> in the URL, headers, params and body. Secret values stay on
          this machine and are never sent to the server.
        </p>
        <Show when={variables()} fallback={<p class="placeholder">Loading variables…</p>}>
          {(res) => (
            <Show when={!res().error} fallback={<p class="form-error">{res().error?.message}</p>}>
              {/* The table scrolls under the fixed header (name, hint); its column heads stick. */}
              <div class="env-var-scroll">
                <table class="var-table">
                  <thead>
                    <tr><th>Key</th><th class="var-type">Type</th><th>Value</th><th class="var-actions" /></tr>
                  </thead>
                  <tbody>
                    <For each={rows}>
                      {(v, i) => (
                        <VariableRow
                          envId={props.envId}
                          variable={v}
                          first={i() === 0}
                          last={i() === rows.length - 1}
                          onStructureChanged={structureChanged}
                          onValueSaved={() => void refreshEnvContext()}
                        />
                      )}
                    </For>
                    <NewVariableRow envId={props.envId} onCreated={structureChanged} />
                  </tbody>
                </table>
              </div>
            </Show>
          )}
        </Show>
      </section>
    </div>
  );
}
