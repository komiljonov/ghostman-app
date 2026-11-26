import { createSignal, For, Show } from "solid-js";
import { CreateEnvironment, ReorderEnvironments } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { envContext, refreshEnvContext } from "../envStore";
import { createRowDrag } from "../rowDrag";
import { saveOrder } from "../rowOrder";
import EnvironmentItem from "./EnvironmentItem";
import FormError from "./FormError";
import InlineCreateForm from "./InlineCreateForm";
import RowDragLayer from "./RowDragLayer";

interface Props {
  projectId: string;
  onOpenEnv: (id: string, name: string) => void;
}

// The "Environments" tab (opened by "Manage environments…"): create, rename,
// reorder and delete environments. Clicking one opens it in its own tab.
export default function EnvListView(props: Props) {
  const environments = () => envContext()?.environments ?? [];

  // Drag and drop reorders the list (and with it the env switcher: same sort_order);
  // the full order is saved, then the env context re-fetched.
  let list: HTMLUListElement | undefined;
  const [orderError, setOrderError] = createSignal<string>();
  const drag = createRowDrag({
    list: () => list,
    ignore: "input, .env-actions",
    label: (id) => environments().find((e) => e.id === id)?.name ?? "",
    onDrop: (order) => void saveOrder(order, {
      save: async (ids) => {
        const r = await ReorderEnvironments(props.projectId, ids);
        handleProblem(r.error);
        return r;
      },
      reload: refreshEnvContext,
      onError: setOrderError,
    }),
  });

  return (
    <div class="env-manage">
      <div class="pane-kicker">Environments</div>
      <div class="env-list wide">
        <FormError message={orderError()} />
        <Show when={environments().length > 0} fallback={<p class="placeholder small">No environments yet — create one</p>}>
          <ul ref={list} onPointerDown={drag.onPointerDown}>
            <For each={environments()}>
              {(env) => (
                <EnvironmentItem
                  projectId={props.projectId}
                  env={env}
                  selected={false}
                  active={env.id === envContext()?.active_id}
                  dragging={drag.isDragging(env.id)}
                  onSelect={() => !drag.consumeClick() && props.onOpenEnv(env.id, env.name)}
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
        <p class="muted small">Click an environment to edit its variables in a tab; drag one to reorder.</p>
      </div>
      <RowDragLayer view={drag.view()} />
    </div>
  );
}
