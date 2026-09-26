import { Show } from "solid-js";
import { RemoveMember } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { createAction } from "../action";

interface Props {
  teamId: string;
  member: api.TeamMember;
  isMe: boolean;
  isOwnerRow: boolean;
  canRemove: boolean;
  canEditAccess: boolean;
  onEditAccess: () => void;
  onRemoved: () => void;
}

export default function MemberRow(props: Props) {
  const remove = createAction(RemoveMember);

  const onRemove = async () => {
    const result = await remove.run(props.teamId, props.member.user_id);
    if (result && !result.error) props.onRemoved();
  };

  return (
    <tr>
      <td>
        {props.member.name || "(no name)"}
        <Show when={props.isMe}> <span class="muted">(you)</span></Show>
        <Show when={props.isOwnerRow}> <span class="badge">owner</span></Show>
      </td>
      <td class="muted">{props.member.email}</td>
      <td class="muted small">
        <Show when={props.canEditAccess}>{props.member.all_projects ? "All projects" : "Selected projects"}</Show>
      </td>
      <td class="cell-actions">
        <Show when={props.canEditAccess}>
          <button type="button" class="small-button" onClick={() => props.onEditAccess()}>Access</button>{" "}
        </Show>
        <Show when={props.canRemove}>
          <button type="button" class="small-button" onClick={onRemove} disabled={remove.pending()}>
            {remove.pending() ? "Removing…" : "Remove"}
          </button>
        </Show>
        <Show when={remove.error()}>
          <span class="inline-error">{remove.error()}</span>
        </Show>
      </td>
    </tr>
  );
}
