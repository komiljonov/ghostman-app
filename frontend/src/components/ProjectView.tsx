import { createResource, Show } from "solid-js";
import { GetProject } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";

interface Props {
  projectId: string;
  refreshTick: number;
  onBack: () => void;
}

// Placeholder project page: folders and requests land here in the next step.
export default function ProjectView(props: Props) {
  const [project] = createResource(() => ({ id: props.projectId, tick: props.refreshTick }), async (src) => {
    const result = await GetProject(src.id);
    handleProblem(result.error);
    return result;
  });

  return (
    <div class="team-view">
      <button type="button" class="link back" onClick={() => props.onBack()}>← Back to team</button>
      <Show when={project()} fallback={<p class="placeholder">Loading project…</p>}>
        {(res) => (
          <Show when={res().data} fallback={<p class="form-error">{res().error?.message}</p>}>
            {(p) => (
              <>
                <h2>{p().name}</h2>
                <p class="placeholder">Folders &amp; requests come next.</p>
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
