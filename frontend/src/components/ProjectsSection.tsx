import { createResource, For, Show } from "solid-js";
import { ListProjects } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import ProjectRow from "./ProjectRow";
import NewProjectForm from "./NewProjectForm";

interface Props {
  teamId: string;
  me: string;
  isTeamOwner: boolean;
  // Reordering must name every team project, so only callers who see them all can do it.
  canReorder: boolean;
  refreshTick: number;
  onOpenProject: (id: string) => void;
  onEditAccess: (project: api.ProjectSummary) => void;
}

export default function ProjectsSection(props: Props) {
  const [projects, { refetch }] = createResource(
    () => ({ id: props.teamId, tick: props.refreshTick }),
    async (src) => {
      const result = await ListProjects(src.id);
      handleProblem(result.error);
      return result;
    },
  );
  const changed = () => void refetch();

  return (
    <section class="projects">
      <h3>Projects</h3>
      <Show when={projects()} fallback={<p class="placeholder">Loading projects…</p>}>
        {(res) => (
          <Show when={!res().error} fallback={<p class="form-error">{res().error?.message}</p>}>
            <Show when={res().data.length > 0} fallback={<p class="placeholder">No projects yet — create one</p>}>
              <ul class="rows">
                <For each={res().data}>
                  {(project, i) => (
                    <ProjectRow
                      teamId={props.teamId}
                      project={project}
                      isMine={project.owner_id === props.me}
                      canManage={props.isTeamOwner || project.owner_id === props.me}
                      canEditAccess={props.isTeamOwner}
                      canMoveUp={props.canReorder && i() > 0}
                      canMoveDown={props.canReorder && i() < res().data.length - 1}
                      onOpen={() => props.onOpenProject(project.id)}
                      onEditAccess={() => props.onEditAccess(project)}
                      onChanged={changed}
                    />
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        )}
      </Show>
      <NewProjectForm teamId={props.teamId} onCreated={changed} />
    </section>
  );
}
