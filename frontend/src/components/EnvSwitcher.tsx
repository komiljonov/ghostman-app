import { For, Show } from "solid-js";
import { envContext, refreshEnvContext, selectEnvironment } from "../envStore";
import Dropdown from "./Dropdown";

interface Props {
  disabled: boolean; // no project selected
  onManage: () => void;
}

// Top-bar environment picker: "No environment", the project's environments, and
// "Manage environments…". The choice is remembered per project (in Go).
export default function EnvSwitcher(props: Props) {
  const activeId = () => envContext()?.active_id ?? "";

  return (
    <Dropdown
      triggerLabel="Switch environment"
      disabled={props.disabled}
      onOpen={() => void refreshEnvContext()}
      trigger={
        <>
          <span class="switcher-kind">Env</span>
          <span classList={{ "switcher-value": true, muted: !activeId() }}>
            {envContext()?.active_name || "No environment"}
          </span>
          <span class="caret">▾</span>
        </>
      }
    >
      {(close) => (
        <>
          <button type="button" role="menuitem" classList={{ "menu-item": true, selected: !activeId() }}
            onClick={() => {
              close();
              void selectEnvironment("");
            }}>
            <span class="nav-label muted">No environment</span>
          </button>
          <For each={envContext()?.environments ?? []}>
            {(env) => (
              <button type="button" role="menuitem" classList={{ "menu-item": true, selected: env.id === activeId() }}
                onClick={() => {
                  close();
                  void selectEnvironment(env.id);
                }}>
                <span class="nav-label">{env.name}</span>
              </button>
            )}
          </For>
          <Show when={(envContext()?.environments ?? []).length === 0}>
            <p class="menu-empty">No environments yet</p>
          </Show>
          <div class="menu-divider" />
          <button type="button" role="menuitem" class="menu-item" onClick={() => {
            close();
            props.onManage();
          }}>Manage environments…</button>
        </>
      )}
    </Dropdown>
  );
}
