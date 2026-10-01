import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { CreateEnvironment, ListVariables } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { envContext, refreshEnvContext } from "../envStore";
import EnvironmentItem from "./EnvironmentItem";
import InlineCreateForm from "./InlineCreateForm";
import NewVariableRow from "./NewVariableRow";
import VariableRow from "./VariableRow";

interface Props {
  projectId: string;
}

// Main-pane view to manage a project's environments and their variables.
export default function ManageEnvironmentsView(props: Props) {
  const environments = () => envContext()?.environments ?? [];
  const [selectedId, setSelectedId] = createSignal<string>();
  const [varsTick, setVarsTick] = createSignal(0);

  // Keep a valid selection: the active environment, else the first one.
  createEffect(() => {
    const list = environments();
    if (!list.some((e) => e.id === selectedId())) {
      setSelectedId(list.find((e) => e.id === envContext()?.active_id)?.id ?? list[0]?.id);
    }
  });
  const selected = () => environments().find((e) => e.id === selectedId());

  const [variables] = createResource(() => (selectedId() ? { id: selectedId()!, tick: varsTick() } : false), async (src) => {
    const result = await ListVariables(src.id);
    handleProblem(result.error);
    return result;
  });

  const structureChanged = () => {
    setVarsTick((n) => n + 1);
    void refreshEnvContext();
  };

  return (
    <div class="env-manage">
      <div class="pane-kicker">Environments</div>
      <div class="env-layout">
        <aside class="env-list">
          <Show when={environments().length > 0} fallback={<p class="placeholder small">No environments yet — create one</p>}>
            <ul>
              <For each={environments()}>
                {(env, i) => (
                  <EnvironmentItem
                    projectId={props.projectId}
                    env={env}
                    selected={env.id === selectedId()}
                    active={env.id === envContext()?.active_id}
                    first={i() === 0}
                    last={i() === environments().length - 1}
                    onSelect={() => setSelectedId(env.id)}
                    onChanged={() => void refreshEnvContext()}
                  />
                )}
              </For>
            </ul>
          </Show>
          <InlineCreateForm label="+ New environment" placeholder="Environment name"
            create={(name) => CreateEnvironment(props.projectId, name)}
            onCreated={async (id) => {
              await refreshEnvContext();
              setSelectedId(id);
            }} />
        </aside>

        <section class="env-vars">
          <Show when={selected()} fallback={<p class="placeholder">Create an environment to add variables.</p>}>
            {(env) => (
              <>
                <h2>{env().name}</h2>
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
                                envId={env().id}
                                variable={v}
                                first={i() === 0}
                                last={i() === res().data.length - 1}
                                onStructureChanged={structureChanged}
                                onValueSaved={() => void refreshEnvContext()}
                              />
                            )}
                          </For>
                          <NewVariableRow envId={env().id} onCreated={structureChanged} />
                        </tbody>
                      </table>
                    </Show>
                  )}
                </Show>
              </>
            )}
          </Show>
        </section>
      </div>
    </div>
  );
}
