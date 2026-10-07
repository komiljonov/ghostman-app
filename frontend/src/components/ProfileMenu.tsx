import { Show } from "solid-js";
import { authState } from "../authStore";
import Dropdown from "./Dropdown";

interface Props {
  invitationCount: number;
  loggingOut: boolean;
  onOpen: () => void;
  onInvitations: () => void;
  onHistory: () => void;
  historyDisabled: boolean; // no project selected (tabs belong to a project)
  onSettings: () => void;
  onLogout: () => void;
}

function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email[0] ?? "?").toUpperCase();
}

export default function ProfileMenu(props: Props) {
  const user = () => authState().user;

  return (
    <Dropdown
      triggerLabel="Profile menu"
      triggerClass="avatar-trigger"
      align="right"
      onOpen={props.onOpen}
      trigger={
        <span class="avatar">
          {initials(user()?.name ?? "", user()?.email ?? "")}
          <Show when={props.invitationCount > 0}><span class="avatar-dot" aria-label="Pending invitations" /></Show>
        </span>
      }
    >
      {(close) => {
        const item = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <div class="menu-user">
              <strong>{user()?.name || "(no name)"}</strong>
              <span class="muted small">{user()?.email}</span>
            </div>
            <div class="menu-divider" />
            <button type="button" role="menuitem" class="menu-item" onClick={item(props.onInvitations)}>
              <span class="nav-label">Invitations</span>
              <Show when={props.invitationCount > 0}><span class="badge count">{props.invitationCount}</span></Show>
            </button>
            <button type="button" role="menuitem" class="menu-item" disabled={props.historyDisabled}
              title={props.historyDisabled ? "Select a project first" : "Requests sent from this computer"}
              onClick={item(props.onHistory)}>History</button>
            <button type="button" role="menuitem" class="menu-item" onClick={item(props.onSettings)}>Settings</button>
            <div class="menu-divider" />
            <button type="button" role="menuitem" class="menu-item" disabled={props.loggingOut}
              onClick={item(props.onLogout)}>
              {props.loggingOut ? "Logging out…" : "Log out"}
            </button>
          </>
        );
      }}
    </Dropdown>
  );
}
