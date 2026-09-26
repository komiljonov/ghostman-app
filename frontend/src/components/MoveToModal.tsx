import { createSignal, For, Show } from "solid-js";
import { MoveFolder, MoveRequest } from "../../wailsjs/go/main/App";
import { createAction } from "../action";
import { flattenFolders, folderAndDescendantIds, TreeNode } from "../tree";
import { useTree } from "../treeContext";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  node: TreeNode;
  onClose: () => void;
}

// "Move to…": pick a folder (or the project root). A folder cannot go into itself
// or its descendants, so those targets are hidden; the server enforces it too.
export default function MoveToModal(props: Props) {
  const tree = useTree();
  const currentParent = () => (props.node.kind === "folder" ? props.node.parentId : props.node.folderId) ?? "";
  const [target, setTarget] = createSignal(currentParent());
  const move = createAction((to: string) =>
    props.node.kind === "folder" ? MoveFolder(props.node.id, to) : MoveRequest(props.node.id, to),
  );

  const hidden = () => {
    const folder = props.node.kind === "folder" ? tree.tree().folders.get(props.node.id) : undefined;
    return folder ? folderAndDescendantIds(folder) : new Set<string>();
  };
  const targets = () => flattenFolders(tree.tree()).filter((x) => !hidden().has(x.folder.id));

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (target() === currentParent()) {
      props.onClose();
      return;
    }
    const result = await move.run(target());
    if (result && !result.error) {
      if (target()) tree.expand(target()); // show where it went
      await tree.reload();
      props.onClose();
    }
  };

  return (
    <Modal title={`Move "${props.node.name}" to…`} onClose={props.onClose}>
      <form class="access-form" onSubmit={submit}>
        <div class="check-list move-targets">
          <label class="choice">
            <input type="radio" name="target" checked={target() === ""} onChange={() => setTarget("")} />
            Project root
            <Show when={currentParent() === ""}><span class="muted small">(current)</span></Show>
          </label>
          <For each={targets()}>
            {(x) => (
              <label class="choice" style={{ "padding-left": `${(x.depth + 1) * 16}px` }}>
                <input type="radio" name="target" checked={target() === x.folder.id} onChange={() => setTarget(x.folder.id)} />
                {x.folder.name}
                <Show when={currentParent() === x.folder.id}><span class="muted small">(current)</span></Show>
              </label>
            )}
          </For>
        </div>
        <FormError message={move.error()} />
        <div class="modal-actions">
          <button type="button" onClick={() => props.onClose()}>Cancel</button>
          <button class="primary" type="submit" disabled={move.pending()}>{move.pending() ? "Moving…" : "Move"}</button>
        </div>
      </form>
    </Modal>
  );
}
