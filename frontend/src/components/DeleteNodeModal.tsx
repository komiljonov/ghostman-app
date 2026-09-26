import { DeleteFolder, DeleteRequest } from "../../wailsjs/go/main/App";
import { createAction } from "../action";
import { TreeNode } from "../tree";
import { useTree } from "../treeContext";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  node: TreeNode;
  onClose: () => void;
}

// Confirmation for deleting a tree row; a folder takes its whole subtree with it.
export default function DeleteNodeModal(props: Props) {
  const tree = useTree();
  const del = createAction(() =>
    props.node.kind === "folder" ? DeleteFolder(props.node.id) : DeleteRequest(props.node.id),
  );

  const confirm = async () => {
    const result = await del.run();
    if (result && !result.error) {
      await tree.reload();
      props.onClose();
    }
  };

  return (
    <Modal title={props.node.kind === "folder" ? "Delete folder" : "Delete request"} onClose={props.onClose}>
      <p class="warning">
        {props.node.kind === "folder"
          ? `Delete folder "${props.node.name}"? This deletes everything inside it.`
          : `Delete request "${props.node.name}"?`}
      </p>
      <FormError message={del.error()} />
      <div class="modal-actions">
        <button type="button" onClick={() => props.onClose()}>Cancel</button>
        <button type="button" class="danger" onClick={confirm} disabled={del.pending()}>
          {del.pending() ? "Deleting…" : "Delete"}
        </button>
      </div>
    </Modal>
  );
}
