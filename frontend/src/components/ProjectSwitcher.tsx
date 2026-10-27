import { For, Show } from "solid-js";
import { CreateProject } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { authState } from "../authStore";
import Dropdown from "./Dropdown";
import InlineCreateForm from "./InlineCreateForm";

interface Props {
  teamId: string; // "" when there is no team
  projects: api.ProjectSummary[]; // accessible projects, in team order
  currentId: string;
  onOpen: () => void;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onOpenSettings: () => void;
}

export default function ProjectSwitcher(props: Props) {
  const current = () => props.projects.find((p) => p.id === props.currentId);

  return (
    <Dropdown
      triggerLabel="Switch project"
      disabled={!props.teamId}
      onOpen={props.onOpen}
      trigger={
        <>
          <span class="switcher-kind">Project</span>
          <span class="switcher-value">{current()?.name ?? "No project"}</span>
          <span class="caret">▾</span>
        </>
      }
    >
      {(close) => (
        <>
          <div class="menu-heading">Projects</div>
          <Show when={props.projects.length > 0} fallback={<p class="menu-empty">No projects yet — create one</p>}>
            <For each={props.projects}>
              {(project) => (
                <button type="button" role="menuitem"
                  classList={{ "menu-item": true, selected: project.id === props.currentId }}
                  onClick={() => {
                    close();
                    props.onSelect(project.id);
                  }}>
                  <span class="nav-label">{project.name}</span>
                  <Show when={project.owner_id === authState().user?.id}><span class="badge">yours</span></Show>
                </button>
              )}
            </For>
          </Show>
          <InlineCreateForm label="+ New project" placeholder="Project name"
            create={(name) => CreateProject(props.teamId, name)}
            onCreated={(id) => {
              close();
              props.onCreated(id);
            }} />
          <Show when={current()}>
            <div class="menu-divider" />
            <button type="button" role="menuitem" class="menu-item" onClick={() => {
              close();
              props.onOpenSettings();
            }}>Project settings</button>
          </Show>
        </>
      )}
    </Dropdown>
  );
}
