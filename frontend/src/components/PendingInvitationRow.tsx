import { Show } from "solid-js";
import { RevokeInvitation } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";

interface Props {
  invitation: api.TeamInvitation;
  onRevoked: () => void;
}

export default function PendingInvitationRow(props: Props) {
  const revoke = createAction(RevokeInvitation);

  const onRevoke = async () => {
    const result = await revoke.run(props.invitation.id);
    if (result && !result.error) props.onRevoked();
  };

  return (
    <li class="row-item">
      <span>{props.invitation.email}</span>
      <span class="muted small">invited {new Date(props.invitation.created_at).toLocaleString()}</span>
      <span class="row-spacer" />
      <Show when={revoke.error()}>
        <span class="inline-error">{revoke.error()}</span>
      </Show>
      <button type="button" class="small-button" onClick={onRevoke} disabled={revoke.pending()}>
        {revoke.pending() ? "Revoking…" : "Revoke"}
      </button>
    </li>
  );
}
