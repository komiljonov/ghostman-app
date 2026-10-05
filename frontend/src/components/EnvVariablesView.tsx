import { createResource, createSignal, For, Show } from "solid-js";
import { ListVariables } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { envContext, refreshEnvContext } from "../envStore";
import NewVariableRow from "./NewVariableRow";
import VariableRow from "./VariableRow";

interface Props {
  envId: string;
}

// An environment tab: its variables table (key / type / value, secrets local-only,
// values autosaved). Rows flush pending edits when this view unmounts, i.e. when
// the tab is closed or another tab becomes active.
export default function EnvVariablesView(props: Props) {
  const [tick, setTick] = createSignal(0);
  const env = () => envContext()?.environments.find((e) => e.id === props.envId);

  const [variables] = createResource(() => ({ id: props.envId, tick: tick() }), async (src) => {
    const result = await ListVariables(src.id);
    handleProblem(result.error);
    return result;
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
              <table class="var-table">
                <thead>
                  <tr><th>Key</th><th class="var-type">Type</th><th>Value</th><th class="var-actions" /></tr>
                </thead>
                <tbody>
                  <For each={res().data}>
                    {(v, i) => (
                      <VariableRow
                        envId={props.envId}
                        variable={v}
                        first={i() === 0}
                        last={i() === res().data.length - 1}
                        onStructureChanged={structureChanged}
                        onValueSaved={() => void refreshEnvContext()}
                      />
                    )}
                  </For>
                  <NewVariableRow envId={props.envId} onCreated={structureChanged} />
                </tbody>
              </table>
            </Show>
          )}
        </Show>
      </section>
    </div>
  );
}
