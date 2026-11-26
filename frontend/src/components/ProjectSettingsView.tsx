import { createResource, createSignal, For, Show } from "solid-js";
import { DeleteProject, GetTeam, ReorderProjects, UpdateProjectName } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { authState, handleProblem } from "../authStore";
import { createAction } from "../action";
import ConfirmButton from "./ConfirmButton";
import FormError from "./FormError";
import ProjectAccessModal from "./ProjectAccessModal";
import Icon from "./Icon";
import RowDragLayer from "./RowDragLayer";
import { createRowDrag } from "../rowDrag";
import { saveOrder } from "../rowOrder";

interface Props {
  teamId: string;
  project: api.ProjectSummary; // the current project
  projects: api.ProjectSummary[]; // all accessible projects of the team, in order
  refreshTick: number;
  onChanged: () => void; // re-fetch the workspace (names, order, access)
  onDeleted: () => void;
}

// Project settings (main pane): rename, access, delete, and the team's project order.
export default function ProjectSettingsView(props: Props) {
  const me = () => authState().user?.id ?? "";
  const [team] = createResource(() => ({ id: props.teamId, tick: props.refreshTick }), async (src) => {
    const result = await GetTeam(src.id);
    handleProblem(result.error);
    return result;
  });
  const isTeamOwner = () => team()?.data?.is_owner ?? false;
  const canManage = () => isTeamOwner() || props.project.owner_id === me();
  // Reordering must name every team project, so only callers who see them all can do it.
  const canReorder = () =>
    isTeamOwner() || (team()?.data?.members.find((m) => m.user_id === me())?.all_projects ?? false);

  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const [accessOpen, setAccessOpen] = createSignal(false);
  const rename = createAction(UpdateProjectName);
  // The project order: rows drag to reorder (rowDrag.ts); the full team order is
  // saved, then the workspace re-fetched.
  let orderList: HTMLUListElement | undefined;
  const [orderError, setOrderError] = createSignal<string>();
  const drag = createRowDrag({
    list: () => orderList,
    label: (id) => props.projects.find((p) => p.id === id)?.name ?? "",
    onDrop: (order) => void saveOrder(order, {
      save: async (ids) => {
        const r = await ReorderProjects(props.teamId, ids);
        handleProblem(r.error);
        return r;
      },
      reload: props.onChanged,
      onError: setOrderError,
    }),
  });

  const submitRename = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await rename.run(props.project.id, name());
    if (result && !result.error) {
      setEditing(false);
      props.onChanged();
    }
  };

  return (
    <div class="team-view">
      <div class="pane-kicker">Project settings</div>
      <Show when={editing()} fallback={
        <div class="team-title">
          <h2>{props.project.name}</h2>
          <Show when={props.project.owner_id === me()}><span class="badge">yours</span></Show>
          <Show when={canManage()}>
            <button type="button" class="link" onClick={() => {
              setName(props.project.name);
              rename.setError(undefined);
              setEditing(true);
            }}>Rename</button>
          </Show>
        </div>
      }>
        <form class="inline-form" onSubmit={submitRename}>
          <input type="text" aria-label="Project name" autofocus value={name()} disabled={rename.pending()}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
          <button class="primary" type="submit" disabled={rename.pending()}>
            {rename.pending() ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          <FormError message={rename.error()} />
        </form>
      </Show>

      <Show when={!canManage()}>
        <p class="muted">Only the team owner or the project's owner can change this project.</p>
      </Show>

      <Show when={isTeamOwner()}>
        <h3>Access</h3>
        <div>
          <button type="button" onClick={() => setAccessOpen(true)}>Edit who can open this project…</button>
        </div>
      </Show>

      <h3>Project order</h3>
      <Show when={canReorder()} fallback={
        <p class="muted small">Only the team owner and members with access to all projects can reorder.</p>
      }>
        <p class="muted small">Drag a project to reorder (also in the project switcher).</p>
        <ul class="rows" ref={orderList} onPointerDown={drag.onPointerDown}>
          <For each={props.projects}>
            {(p) => (
              <li classList={{ "row-item": true, current: p.id === props.project.id, "drag-source": drag.isDragging(p.id) }}
                data-drag-id={p.id}>
                <span class="drag-handle" aria-hidden="true"><Icon name="grip" /></span>
                <span>{p.name}</span>
              </li>
            )}
          </For>
        </ul>
        <FormError message={orderError()} />
        <RowDragLayer view={drag.view()} />
      </Show>

      <Show when={canManage()}>
        <div class="danger-zone">
          <ConfirmButton
            label="Delete project"
            prompt={`Delete project "${props.project.name}"? This cannot be undone.`}
            confirmLabel="Delete project"
            action={() => DeleteProject(props.project.id)}
            onDone={props.onDeleted}
          />
        </div>
      </Show>

      <Show when={accessOpen() && team()?.data}>
        {(t) => (
          <ProjectAccessModal project={props.project} members={t().members.filter((m) => m.user_id !== me())}
            onClose={() => setAccessOpen(false)} onSaved={props.onChanged} />
        )}
      </Show>
    </div>
  );
}
