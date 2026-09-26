import { createResource, createSignal, For, Show } from "solid-js";
import { DeleteTeam, GetTeam, ListTeamInvitations, RemoveMember } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { authState, handleProblem } from "../authStore";
import TeamName from "./TeamName";
import MemberRow from "./MemberRow";
import InviteForm from "./InviteForm";
import PendingInvitationRow from "./PendingInvitationRow";
import ConfirmButton from "./ConfirmButton";
import MemberAccessModal from "./MemberAccessModal";

interface Props {
  teamId: string;
  refreshTick: number; // changes when the user asks for fresh data
  onTeamChanged: () => void; // name or member count changed: refresh the sidebar
  onTeamGone: () => void; // deleted, left, or no longer reachable (404)
}

// Team settings (main pane): rename, members + access, invitations, delete / leave.
export default function TeamSettingsView(props: Props) {
  const [team, { refetch: refetchTeam }] = createResource(() => ({ id: props.teamId, tick: props.refreshTick }), async (src) => {
    const result = await GetTeam(src.id);
    handleProblem(result.error);
    // Removed from the team or it was deleted: let the shell fall back instead of showing a dead end.
    if (result.error?.status === 404) props.onTeamGone();
    return result;
  });
  const isOwner = () => team()?.data?.is_owner ?? false;
  const me = () => authState().user?.id ?? "";

  // Only owners may list a team's invitations; `false` skips the fetch.
  const [invitations, { refetch: refetchInvitations }] = createResource(
    () => (isOwner() ? { id: props.teamId, tick: props.refreshTick } : false),
    async (src) => {
      const result = await ListTeamInvitations(src.id);
      handleProblem(result.error);
      return result;
    },
  );

  const [accessMember, setAccessMember] = createSignal<api.TeamMember>();
  // Access decides which projects members see, so the shell re-fetches the workspace too.
  const accessChanged = () => {
    void refetchTeam();
    props.onTeamChanged();
  };

  const membersChanged = () => {
    void refetchTeam();
    props.onTeamChanged();
  };

  return (
    <Show when={!team.loading || team()} fallback={<p class="placeholder">Loading team…</p>}>
      <Show when={team()?.data} fallback={<p class="form-error">{team()?.error?.message}</p>}>
        {(t) => (
          <div class="team-view">
            <div class="pane-kicker">Team settings</div>
            <TeamName team={t()} onRenamed={() => {
              void refetchTeam();
              props.onTeamChanged();
            }} />

            <h3>Members</h3>
            <table class="table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Access</th><th /></tr>
              </thead>
              <tbody>
                <For each={t().members}>
                  {(member) => (
                    <MemberRow
                      teamId={t().id}
                      member={member}
                      isMe={member.user_id === me()}
                      // The owner is the caller when is_owner; nobody may remove the owner.
                      isOwnerRow={t().is_owner && member.user_id === me()}
                      canRemove={t().is_owner && member.user_id !== me()}
                      canEditAccess={t().is_owner && member.user_id !== me()}
                      onEditAccess={() => setAccessMember(member)}
                      onRemoved={membersChanged}
                    />
                  )}
                </For>
              </tbody>
            </table>

            <Show when={t().is_owner}>
              <h3>Invite</h3>
              <InviteForm teamId={t().id} onInvited={() => void refetchInvitations()} />

              <h3>Pending invitations</h3>
              <Show when={invitations()} fallback={<p class="placeholder">Loading…</p>}>
                {(res) => (
                  <Show when={!res().error} fallback={<p class="form-error">{res().error?.message}</p>}>
                    <Show when={res().data.length > 0} fallback={<p class="placeholder">No pending invitations</p>}>
                      <ul class="rows">
                        <For each={res().data}>
                          {(inv) => <PendingInvitationRow invitation={inv} onRevoked={() => void refetchInvitations()} />}
                        </For>
                      </ul>
                    </Show>
                  </Show>
                )}
              </Show>

              <div class="danger-zone">
                <ConfirmButton
                  label="Delete team"
                  prompt={`Delete "${t().name}" for all members? This cannot be undone.`}
                  confirmLabel="Delete team"
                  action={() => DeleteTeam(t().id)}
                  onDone={props.onTeamGone}
                />
              </div>
            </Show>

            <Show when={!t().is_owner}>
              <div class="danger-zone">
                <ConfirmButton
                  label="Leave team"
                  prompt={`Leave "${t().name}"? You will need a new invitation to rejoin.`}
                  confirmLabel="Leave team"
                  action={() => RemoveMember(t().id, me())}
                  onDone={props.onTeamGone}
                />
              </div>
            </Show>

            <Show when={accessMember()}>
              {(m) => (
                <MemberAccessModal teamId={t().id} member={m()} onClose={() => setAccessMember(undefined)}
                  onSaved={accessChanged} />
              )}
            </Show>
          </div>
        )}
      </Show>
    </Show>
  );
}
