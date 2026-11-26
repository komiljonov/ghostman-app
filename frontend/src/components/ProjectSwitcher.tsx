import { createSignal, For, Show } from "solid-js";
import { CreateProject, GetTeam, ReorderProjects } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { authState, handleProblem } from "../authStore";
import { createRowDrag } from "../rowDrag";
import { saveOrder } from "../rowOrder";
import Dropdown from "./Dropdown";
import FormError from "./FormError";
import InlineCreateForm from "./InlineCreateForm";
import RowDragLayer from "./RowDragLayer";

interface Props {
  teamId: string; // "" when there is no team
  projects: api.ProjectSummary[]; // accessible projects, in team order
  isOwner: boolean; // of the current team
  currentId: string;
  onOpen: () => void;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onOpenSettings: () => void;
}

// The top bar's project switcher. Projects drag to reorder the team order
// (rowDrag.ts; a click still selects) — only for callers who see EVERY team
// project (the owner, members with access to all projects), as the order endpoint
// needs the full list; the membership is read when the menu opens.
export default function ProjectSwitcher(props: Props) {
  const current = () => props.projects.find((p) => p.id === props.currentId);
  const [allProjects, setAllProjects] = createSignal(false);
  const canReorder = () => props.isOwner || allProjects();
  const opened = () => {
    props.onOpen();
    if (props.isOwner || !props.teamId) return;
    void GetTeam(props.teamId).then((r) => {
      const me = authState().user?.id;
      setAllProjects(!!r.data?.members.find((m) => m.user_id === me)?.all_projects);
    });
  };

  let list: HTMLDivElement | undefined;
  const [orderError, setOrderError] = createSignal<string>();
  const drag = createRowDrag({
    list: () => list,
    ignore: "input",
    canStart: canReorder,
    label: (id) => props.projects.find((p) => p.id === id)?.name ?? "",
    onDrop: (order) => void saveOrder(order, {
      save: async (ids) => {
        const r = await ReorderProjects(props.teamId, ids);
        handleProblem(r.error);
        return r;
      },
      reload: props.onOpen, // the workspace refresh: projects in the new order
      onError: setOrderError,
    }),
  });

  return (
    <Dropdown
      triggerLabel="Switch project"
      disabled={!props.teamId}
      onOpen={opened}
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
            <div ref={list} onPointerDown={drag.onPointerDown} title={canReorder() ? "Drag to reorder" : undefined}>
            <For each={props.projects}>
              {(project) => (
                <button type="button" role="menuitem" data-drag-id={project.id}
                  classList={{ "menu-item": true, selected: project.id === props.currentId, "drag-source": drag.isDragging(project.id) }}
                  onClick={() => {
                    if (drag.consumeClick()) return;
                    close();
                    props.onSelect(project.id);
                  }}>
                  <span class="nav-label">{project.name}</span>
                  <Show when={project.owner_id === authState().user?.id}><span class="badge">yours</span></Show>
                </button>
              )}
            </For>
            </div>
            <FormError message={orderError()} />
            <RowDragLayer view={drag.view()} />
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
