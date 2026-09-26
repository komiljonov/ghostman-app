import { createResource, createSignal, For, Show } from "solid-js";
import { GetProjectAccess, SetProjectAccess } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import { createAction } from "../action";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  project: api.ProjectSummary;
  members: api.TeamMember[]; // the team's members, excluding the team owner
  onClose: () => void;
  onSaved: () => void;
}

// Team owner edits a project's explicit grant list.
export default function ProjectAccessModal(props: Props) {
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const save = createAction(SetProjectAccess);

  const [current] = createResource(async () => {
    const result = await GetProjectAccess(props.project.id);
    handleProblem(result.error);
    if (result.data) setSelected(new Set(result.data.map((u) => u.user_id)));
    return result;
  });

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected());
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await save.run(props.project.id, [...selected()]);
    if (result && !result.error) {
      props.onSaved();
      props.onClose();
    }
  };

  return (
    <Modal title={`Access to ${props.project.name}`} onClose={props.onClose}>
      <Show when={current()} fallback={<p class="placeholder">Loading…</p>}>
        {(res) => (
          <Show when={!res().error} fallback={<p class="form-error">{res().error?.message}</p>}>
            <form class="access-form" onSubmit={submit}>
              <p class="muted small">
                This list matters only for members with restricted access; members with
                "All projects" and the project owner always have access.
              </p>
              <div class="check-list">
                <Show when={props.members.length > 0} fallback={<p class="placeholder small">No other members yet.</p>}>
                  <For each={props.members}>
                    {(m) => (
                      <label class="choice">
                        <input type="checkbox" checked={selected().has(m.user_id)}
                          onChange={(e) => toggle(m.user_id, e.currentTarget.checked)} />
                        {m.name || m.email} <span class="muted small">{m.email}</span>
                        <Show when={m.all_projects}><span class="badge">all projects</span></Show>
                        <Show when={m.user_id === props.project.owner_id}><span class="badge">project owner</span></Show>
                      </label>
                    )}
                  </For>
                </Show>
              </div>
              <FormError message={save.error()} />
              <div class="modal-actions">
                <button type="button" onClick={() => props.onClose()}>Cancel</button>
                <button class="primary" type="submit" disabled={save.pending()}>
                  {save.pending() ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </Show>
        )}
      </Show>
    </Modal>
  );
}
