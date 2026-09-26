import { For, Show } from "solid-js";
import { api } from "../../wailsjs/go/models";
import MyInvitationRow from "./MyInvitationRow";

interface Props {
  invitations: api.MyInvitation[] | undefined; // undefined while loading
  error: string | undefined;
  onChanged: () => void;
  onAccepted: (teamId: string) => void;
}

export default function InvitationsView(props: Props) {
  return (
    <div class="team-view">
      <h2>Invitations</h2>
      <Show when={props.error}>
        <p class="form-error">{props.error}</p>
      </Show>
      <Show when={props.invitations} fallback={<p class="placeholder">Loading…</p>}>
        {(list) => (
          <Show when={list().length > 0} fallback={<p class="placeholder">No pending invitations</p>}>
            <ul class="rows">
              <For each={list()}>
                {(inv) => (
                  <MyInvitationRow invitation={inv} onRejected={props.onChanged} onAccepted={props.onAccepted} />
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  );
}
