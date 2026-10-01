import { session } from "../../wailsjs/go/models";
import { createAction } from "../action";
import FormError from "./FormError";
import Modal from "./Modal";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => Promise<{ error?: session.Problem }>;
  onDone: () => void;
  onClose: () => void;
}

// A modal confirmation for an action with consequences; the server's error (if
// any) is shown in the dialog.
export default function ConfirmDialog(props: Props) {
  const act = createAction(() => props.action());
  const confirm = async () => {
    const result = await act.run();
    if (result && !result.error) {
      props.onDone();
      props.onClose();
    }
  };
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p class="warning">{props.message}</p>
      <FormError message={act.error()} />
      <div class="modal-actions">
        <button type="button" onClick={() => props.onClose()}>Cancel</button>
        <button type="button" class="danger" onClick={confirm} disabled={act.pending()}>
          {act.pending() ? "Working…" : props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
