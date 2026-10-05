import { For, Show } from "solid-js";
import { envContext, refreshEnvContext, selectEnvironment } from "../envStore";
import Dropdown from "./Dropdown";

interface Props {
  disabled: boolean; // no project selected
  onEdit: (id: string, name: string) => void; // open the environment's tab
  onManage: () => void; // open the environments list tab
}

// Top-bar environment picker (right side, next to the profile badge): "No
// environment", the project's environments — each with a pencil that opens it in a
// tab — and "Manage environments…". The choice is remembered per project (in Go).
export default function EnvSwitcher(props: Props) {
  const activeId = () => envContext()?.active_id ?? "";

  return (
    <Dropdown
      triggerLabel="Switch environment"
      align="right"
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
              <div classList={{ "menu-item": true, "env-menu-row": true, selected: env.id === activeId() }} role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close();
                  void selectEnvironment(env.id);
                }}>
                <span class="nav-label">{env.name}</span>
                <button type="button" class="env-edit" title={`Edit ${env.name}`} aria-label={`Edit ${env.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    props.onEdit(env.id, env.name);
                  }}>✎</button>
              </div>
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
