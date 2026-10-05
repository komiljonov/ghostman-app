import { For, Show } from "solid-js";
import { CreateEnvironment } from "../../wailsjs/go/main/App";
import { envContext, refreshEnvContext } from "../envStore";
import EnvironmentItem from "./EnvironmentItem";
import InlineCreateForm from "./InlineCreateForm";

interface Props {
  projectId: string;
  onOpenEnv: (id: string, name: string) => void;
}

// The "Environments" tab (opened by "Manage environments…"): create, rename,
// reorder and delete environments. Clicking one opens it in its own tab.
export default function EnvListView(props: Props) {
  const environments = () => envContext()?.environments ?? [];

  return (
    <div class="env-manage">
      <div class="pane-kicker">Environments</div>
      <div class="env-list wide">
        <Show when={environments().length > 0} fallback={<p class="placeholder small">No environments yet — create one</p>}>
          <ul>
            <For each={environments()}>
              {(env, i) => (
                <EnvironmentItem
                  projectId={props.projectId}
                  env={env}
                  selected={false}
                  active={env.id === envContext()?.active_id}
                  first={i() === 0}
                  last={i() === environments().length - 1}
                  onSelect={() => props.onOpenEnv(env.id, env.name)}
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
            const env = environments().find((e) => e.id === id);
            if (env) props.onOpenEnv(env.id, env.name);
          }} />
        <p class="muted small">Click an environment to edit its variables in a tab.</p>
      </div>
    </div>
  );
}
