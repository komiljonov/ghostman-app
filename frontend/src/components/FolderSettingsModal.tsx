import { createSignal, For } from "solid-js";
import { SaveFolderSettings } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import { AuthConfig, modeOptions } from "../auth";
import { redirectDefault } from "../redirectDefault";
import { followOptions, FollowValue, ownFollow } from "../requestSettings";
import { resolveAuthInTree } from "../settingsResolver";
import { currentTree } from "../treeStore";
import AuthEditor from "./AuthEditor";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  folderId: string;
  onSaved: () => void | Promise<void>; // re-fetch the tree: everything below re-resolves
  onClose: () => void;
}

// Folder → "Settings…": the folder's cascading settings (shared with the team on
// the server): Auth and Follow redirects. "Inherit" names where the value comes
// from above this folder. Save sends one PATCH with what changed (built in Go).
export default function FolderSettingsModal(props: Props) {
  const folder = () => currentTree().folders.get(props.folderId);
  const storedFollow = ownFollow(currentTree(), props.folderId);
  const storedAuth: AuthConfig = { ...currentTree().folders.get(props.folderId)!.auth };
  const [choice, setChoice] = createSignal<FollowValue>(storedFollow);
  const [auth, setAuth] = createSignal<AuthConfig>({ ...storedAuth });
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const options = () => followOptions(currentTree(), props.folderId, redirectDefault());
  const effective = () => resolveAuthInTree(currentTree(), props.folderId, auth()) ?? { config: null, source: { kind: "default" as const } };

  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    setPending(true);
    const result = await SaveFolderSettings(props.folderId, storedFollow, choice(),
      api.Auth.createFrom(storedAuth), api.Auth.createFrom(auth()));
    handleProblem(result.error);
    if (result.error) {
      setPending(false);
      setError(result.error.message);
      return;
    }
    if (result.data) await props.onSaved(); // nothing changed = no request, no reload
    setPending(false);
    props.onClose();
  };

  return (
    <Modal title={`Folder settings — ${folder()?.name ?? ""}`} onClose={props.onClose}>
      <form class="folder-settings" onSubmit={save}>
        <fieldset class="request-setting">
          <legend>Auth</legend>
          <AuthEditor auth={auth()} onChange={setAuth} options={modeOptions(currentTree(), props.folderId)}
            effective={effective()} idPrefix={`folder-${props.folderId}`} noun="folder" />
          <p class="request-setting-hint">
            Applies to every request in this folder that inherits. Saved on the server for everyone on the project.
          </p>
        </fieldset>
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
