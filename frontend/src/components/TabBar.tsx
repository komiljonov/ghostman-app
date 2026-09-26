import { For, Show } from "solid-js";
import { TabsController } from "../tabsController";
import MethodBadge from "./MethodBadge";

interface Props {
  controller: TabsController;
}

// Open requests as tabs. Middle-click or × closes; the bar scrolls horizontally.
export default function TabBar(props: Props) {
  return (
    <div class="tab-bar" role="tablist" aria-label="Open requests">
      <For each={props.controller.state.tabs}>
        {(tab) => (
          <div role="tab" aria-selected={props.controller.state.activeId === tab.id} tabIndex={0}
            classList={{ "tab": true, active: props.controller.state.activeId === tab.id }}
            title={tab.name}
            onClick={() => props.controller.activate(tab.id)}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
              if (e.button === 1) void props.controller.close(tab.id);
            }}>
            <Show when={tab.status === "ready"} fallback={<span class="method-badge muted">…</span>}>
              <MethodBadge method={tab.draft.method} />
            </Show>
            <span class="tab-name">{tab.name || "Loading…"}</span>
            <Show when={tab.save === "error"}><span class="tab-unsaved" title="Not saved">●</span></Show>
            <button type="button" class="tab-close" aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void props.controller.close(tab.id);
              }}>×</button>
          </div>
        )}
      </For>
    </div>
  );
}
