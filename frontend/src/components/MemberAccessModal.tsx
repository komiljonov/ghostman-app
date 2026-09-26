import { createResource, createSignal, For, Show } from "solid-js";
import { GetMemberAccess, SetMemberAccess } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import { createAction } from "../action";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  teamId: string;
  member: api.TeamMember;
  onClose: () => void;
  onSaved: () => void;
}

// Team owner edits which projects one member may open.
export default function MemberAccessModal(props: Props) {
  const [allProjects, setAllProjects] = createSignal(true);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const save = createAction(SetMemberAccess);

  const [current] = createResource(async () => {
    const result = await GetMemberAccess(props.teamId, props.member.user_id);
    handleProblem(result.error);
    if (result.data) {
      setAllProjects(result.data.all_projects);
      setSelected(new Set(result.data.projects.filter((p) => p.granted).map((p) => p.id)));
    }
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
    const result = await save.run(props.teamId, props.member.user_id, allProjects(), [...selected()]);
    if (result && !result.error) {
      props.onSaved();
      props.onClose();
    }
  };

  return (
    <Modal title={`Access for ${props.member.name || props.member.email}`} onClose={props.onClose}>
      <Show when={current()} fallback={<p class="placeholder">Loading…</p>}>
        {(res) => (
          <Show when={res().data} fallback={<p class="form-error">{res().error?.message}</p>}>
            {(view) => (
              <form class="access-form" onSubmit={submit}>
                <label class="choice">
                  <input type="radio" name="scope" checked={allProjects()} onChange={() => setAllProjects(true)} />
                  All projects <span class="muted small">(including future ones)</span>
                </label>
                <label class="choice">
                  <input type="radio" name="scope" checked={!allProjects()} onChange={() => setAllProjects(false)} />
                  Selected projects
                </label>
                <div classList={{ "check-list": true, disabled: allProjects() }}>
                  <Show when={view().projects.length > 0} fallback={<p class="placeholder small">This team has no projects yet.</p>}>
                    <For each={view().projects}>
                      {(p) => (
                        <label class="choice">
                          <input type="checkbox" disabled={allProjects()} checked={selected().has(p.id)}
                            onChange={(e) => toggle(p.id, e.currentTarget.checked)} />
                          {p.name}
                        </label>
                      )}
                    </For>
                  </Show>
                </div>
                <p class="muted small">Members always see projects they created.</p>
                <FormError message={save.error()} />
                <div class="modal-actions">
                  <button type="button" onClick={() => props.onClose()}>Cancel</button>
                  <button class="primary" type="submit" disabled={save.pending()}>
                    {save.pending() ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            )}
          </Show>
        )}
      </Show>
    </Modal>
  );
}
