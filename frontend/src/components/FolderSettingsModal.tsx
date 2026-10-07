import { createSignal, For } from "solid-js";
import { SetFolderFollowRedirects } from "../../wailsjs/go/main/App";
import { handleProblem } from "../authStore";
import { redirectDefault } from "../redirectDefault";
import { followOptions, FollowValue, ownFollow, saveFollow } from "../requestSettings";
import { currentTree } from "../treeStore";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  folderId: string;
  onSaved: () => void | Promise<void>; // re-fetch the tree: everything below re-resolves
  onClose: () => void;
}

// Folder → "Settings…": the folder's cascading settings (shared with the team on
// the server). "Inherit" names where the value comes from above this folder.
export default function FolderSettingsModal(props: Props) {
  const folder = () => currentTree().folders.get(props.folderId);
  const [choice, setChoice] = createSignal<FollowValue>(ownFollow(currentTree(), props.folderId));
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const options = () => followOptions(currentTree(), props.folderId, redirectDefault());

  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    if (choice() === ownFollow(currentTree(), props.folderId)) return props.onClose();
    setPending(true);
    const problem = await saveFollow(props.folderId, choice(), { set: SetFolderFollowRedirects, reload: props.onSaved });
    setPending(false);
    handleProblem(problem);
    if (problem) return setError(problem.message);
    props.onClose();
  };

  return (
    <Modal title={`Folder settings — ${folder()?.name ?? ""}`} onClose={props.onClose}>
      <form class="folder-settings" onSubmit={save}>
        <fieldset class="request-setting">
          <legend>Follow redirects</legend>
          <For each={options()}>
            {(o) => (
              <label class="choice">
                <input type="radio" name="folder-follow-redirects" value={o.value} checked={choice() === o.value}
                  onChange={() => setChoice(o.value)} />
                {o.label}
              </label>
            )}
          </For>
          <p class="request-setting-hint">
            Applies to everything in this folder that inherits. Saved on the server for everyone on the project.
          </p>
        </fieldset>
        <FormError message={error()} />
        <div class="modal-actions">
          <button type="button" onClick={() => props.onClose()}>Cancel</button>
          <button type="submit" class="primary" disabled={pending()}>{pending() ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
