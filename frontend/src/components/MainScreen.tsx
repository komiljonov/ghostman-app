import { createSignal, Match, onMount, Switch } from "solid-js";
import { ListMyInvitations, ListTeams, Logout } from "../../wailsjs/go/main/App";
import { api } from "../../wailsjs/go/models";
import { authState, handleProblem, setAuthState } from "../authStore";
import GearButton from "./GearButton";
import Sidebar, { Selection } from "./Sidebar";
import TeamView from "./TeamView";
import InvitationsView from "./InvitationsView";
import Workspace from "./Workspace";

interface Props {
  onOpenSettings: () => void;
}

// App shell v1: sidebar (teams, invitations, scratch) + main pane. All data is
// fetched from the server on demand and re-fetched after every mutation.
export default function MainScreen(props: Props) {
  const [loggingOut, setLoggingOut] = createSignal(false);
  const [selection, setSelection] = createSignal<Selection>({ kind: "none" });
  const [teams, setTeams] = createSignal<api.TeamSummary[]>();
  const [teamsError, setTeamsError] = createSignal<string>();
  const [invitations, setInvitations] = createSignal<api.MyInvitation[]>();
  const [invitationsError, setInvitationsError] = createSignal<string>();

  const refreshTeams = async () => {
    const result = await ListTeams();
    handleProblem(result.error);
    setTeamsError(result.error?.message);
    if (!result.error) setTeams(result.data);
  };

  const refreshInvitations = async () => {
    const result = await ListMyInvitations();
    handleProblem(result.error);
    setInvitationsError(result.error?.message);
    if (!result.error) setInvitations(result.data);
  };

  // Bumped on every refresh so the open team view re-fetches too.
  const [refreshTick, setRefreshTick] = createSignal(0);
  const refreshAll = () => {
    setRefreshTick((n) => n + 1);
    return Promise.all([refreshTeams(), refreshInvitations()]);
  };

  onMount(refreshAll);

  const logout = async () => {
    setLoggingOut(true);
    try {
      setAuthState(await Logout());
    } finally {
      setLoggingOut(false);
    }
  };

  const selectTeam = (id: string) => setSelection({ kind: "team", id });

  return (
    <div class="main-screen">
      <header class="topbar">
        <strong class="brand">Ghostman</strong>
        <div class="topbar-user">
          <span class="user-name">{authState().user?.name || "(no name)"}</span>
          <span class="muted">{authState().user?.email}</span>
          <GearButton onClick={props.onOpenSettings} />
          <button type="button" onClick={logout} disabled={loggingOut()}>
            {loggingOut() ? "Logging out…" : "Log out"}
          </button>
        </div>
      </header>
      <div class="shell">
        <Sidebar
          teams={teams()}
          teamsError={teamsError()}
          invitationCount={invitations()?.length ?? 0}
          selection={selection()}
          onSelect={(s) => {
            setSelection(s);
            void refreshAll();
          }}
          onRefresh={refreshAll}
          onTeamCreated={async (id) => {
            await refreshTeams();
            selectTeam(id);
          }}
        />
        <section class="pane">
          <Switch fallback={<p class="placeholder">Select a team, or create one.</p>}>
            <Match when={selection().kind === "team" && (selection() as { id: string }).id}>
              {(id) => (
                <TeamView
                  teamId={id()}
                  refreshTick={refreshTick()}
                  onTeamChanged={refreshTeams}
                  onTeamGone={async () => {
                    setSelection({ kind: "none" });
                    await refreshTeams();
                  }}
                />
              )}
            </Match>
            <Match when={selection().kind === "invitations"}>
              <InvitationsView
                invitations={invitations()}
                error={invitationsError()}
                onChanged={refreshInvitations}
                onAccepted={async (teamId) => {
                  await refreshAll();
                  selectTeam(teamId);
                }}
              />
            </Match>
            <Match when={selection().kind === "scratch"}>
              <Workspace />
            </Match>
          </Switch>
        </section>
      </div>
    </div>
  );
}
