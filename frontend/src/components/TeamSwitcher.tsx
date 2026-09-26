import { For, Show } from "solid-js";
import { CreateTeam } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import Dropdown from "./Dropdown";
import InlineCreateForm from "./InlineCreateForm";

interface Props {
  teams: api.TeamSummary[];
  currentId: string;
  onOpen: () => void;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onOpenSettings: () => void;
}

export default function TeamSwitcher(props: Props) {
  const current = () => props.teams.find((t) => t.id === props.currentId);

  return (
    <Dropdown
      triggerLabel="Switch team"
      onOpen={props.onOpen}
      trigger={
        <>
          <span class="switcher-kind">Team</span>
          <span class="switcher-value">{current()?.name ?? "No team"}</span>
          <span class="caret">▾</span>
        </>
      }
    >
      {(close) => (
        <>
          <div class="menu-heading">Your teams</div>
          <Show when={props.teams.length > 0} fallback={<p class="menu-empty">No teams yet — create one</p>}>
            <For each={props.teams}>
              {(team) => (
                <button type="button" role="menuitem"
                  classList={{ "menu-item": true, selected: team.id === props.currentId }}
                  onClick={() => {
                    close();
                    props.onSelect(team.id);
                  }}>
                  <span class="nav-label">{team.name}</span>
                  <Show when={team.is_owner}><span class="badge">owner</span></Show>
                  <span class="muted small" title="Members">{team.member_count}</span>
                </button>
              )}
            </For>
          </Show>
          <InlineCreateForm label="+ New team" placeholder="Team name" create={CreateTeam} onCreated={(id) => {
            close();
            props.onCreated(id);
          }} />
          <Show when={current()}>
            <div class="menu-divider" />
            <button type="button" role="menuitem" class="menu-item" onClick={() => {
              close();
              props.onOpenSettings();
            }}>Team settings</button>
          </Show>
        </>
      )}
    </Dropdown>
  );
}
