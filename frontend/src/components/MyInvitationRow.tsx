import { Show } from "solid-js";
import { AcceptInvitation, RejectInvitation } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";

interface Props {
  invitation: api.MyInvitation;
  onRejected: () => void;
  onAccepted: (teamId: string) => void;
}

export default function MyInvitationRow(props: Props) {
  const accept = createAction(AcceptInvitation);
  const reject = createAction(RejectInvitation);
  const busy = () => accept.pending() || reject.pending();

  const onAccept = async () => {
    const result = await accept.run(props.invitation.id);
    if (result?.data) props.onAccepted(result.data.team.id);
  };

  const onReject = async () => {
    const result = await reject.run(props.invitation.id);
    if (result && !result.error) props.onRejected();
  };

  return (
    <li class="row-item">
      <div class="stack">
        <strong>{props.invitation.team.name}</strong>
        <span class="muted small">
          from {props.invitation.invited_by.name || props.invitation.invited_by.email} ({props.invitation.invited_by.email})
          · {new Date(props.invitation.created_at).toLocaleString()}
        </span>
      </div>
      <span class="row-spacer" />
      <Show when={accept.error() || reject.error()}>
        <span class="inline-error">{accept.error() || reject.error()}</span>
      </Show>
      <button type="button" class="primary small-button" onClick={onAccept} disabled={busy()}>
        {accept.pending() ? "Accepting…" : "Accept"}
      </button>
      <button type="button" class="small-button" onClick={onReject} disabled={busy()}>
        {reject.pending() ? "Rejecting…" : "Reject"}
      </button>
    </li>
  );
}
