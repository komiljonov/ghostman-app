import { For, Show } from "solid-js";
import { api } from "../../wailsjs/go/models";
import NewTeamForm from "./NewTeamForm";

export type Selection =
  | { kind: "none" }
  | { kind: "team"; id: string }
  | { kind: "project"; teamId: string; projectId: string }
  | { kind: "invitations" }
  | { kind: "scratch" };

interface Props {
  teams: api.TeamSummary[] | undefined; // undefined while loading
  teamsError: string | undefined;
  invitationCount: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onRefresh: () => void;
  onTeamCreated: (id: string) => void;
}

export default function Sidebar(props: Props) {
  const isTeam = (id: string) =>
    (props.selection.kind === "team" && props.selection.id === id) ||
    (props.selection.kind === "project" && props.selection.teamId === id);

  return (
    <nav class="sidebar">
      <div class="sidebar-heading">
        <span>Teams</span>
        <button type="button" class="link" title="Refresh from server" onClick={() => props.onRefresh()}>
          Refresh
        </button>
      </div>
      <Show when={props.teamsError}>
        <p class="form-error">{props.teamsError}</p>
      </Show>
      <Show when={props.teams} fallback={<p class="placeholder small">Loading teams…</p>}>
        {(teams) => (
          <Show when={teams().length > 0} fallback={<p class="placeholder small">No teams yet — create one</p>}>
            <ul class="nav-list">
              <For each={teams()}>
                {(team) => (
                  <li>
                    <button type="button" classList={{ "nav-item": true, active: isTeam(team.id) }}
                      onClick={() => props.onSelect({ kind: "team", id: team.id })}>
                      <span class="nav-label">{team.name}</span>
                      <Show when={team.is_owner}>
                        <span class="badge">owner</span>
                      </Show>
                      <span class="muted small" title="Members">{team.member_count}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
      <NewTeamForm onCreated={props.onTeamCreated} />

      <div class="sidebar-section">
        <button type="button" classList={{ "nav-item": true, active: props.selection.kind === "invitations" }}
          onClick={() => props.onSelect({ kind: "invitations" })}>
          <span class="nav-label">Invitations</span>
          <Show when={props.invitationCount > 0}>
            <span class="badge count">{props.invitationCount}</span>
          </Show>
        </button>
        <button type="button" classList={{ "nav-item": true, active: props.selection.kind === "scratch" }}
          onClick={() => props.onSelect({ kind: "scratch" })}>
          <span class="nav-label">Scratch</span>
          <span class="muted small">send requests</span>
        </button>
      </div>
    </nav>
  );
}
