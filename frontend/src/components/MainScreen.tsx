import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { ListMyInvitations, LoadWorkspace, Logout, SelectProject, SelectTeam } from "../../wailsjs/go/main/App";
import { api, main, workspace } from "../../wailsjs/go/models";
import { handleProblem, setAuthState } from "../authStore";
import TeamSwitcher from "./TeamSwitcher";
import ProjectSwitcher from "./ProjectSwitcher";
import ProfileMenu from "./ProfileMenu";
import ProjectSidebar from "./ProjectSidebar";
import ProjectTree from "./ProjectTree";
import RequestPlaceholder from "./RequestPlaceholder";
import TeamSettingsView from "./TeamSettingsView";
import ProjectSettingsView from "./ProjectSettingsView";
import InvitationsView from "./InvitationsView";
import ScratchView from "./ScratchView";

interface Props {
  onOpenSettings: () => void;
}

type Pane = "none" | "team-settings" | "project-settings" | "invitations" | "scratch" | "request";

// App shell (Postman-style): top bar with team/project switchers and profile menu,
// left sidebar for the project tree, main pane for whatever is open. The Go side
// owns the current team/project (persisted, validated on every load); this only
// renders the snapshot it returns and re-fetches after every change.
export default function MainScreen(props: Props) {
  const [ws, setWs] = createSignal<workspace.Workspace>();
  const [wsError, setWsError] = createSignal<string>();
  const [pane, setPane] = createSignal<Pane>("none");
  const [invitations, setInvitations] = createSignal<api.MyInvitation[]>();
  const [invitationsError, setInvitationsError] = createSignal<string>();
  const [loggingOut, setLoggingOut] = createSignal(false);
  const [openRequestId, setOpenRequestId] = createSignal<string>();
  // Bumped on every refresh so open views re-fetch their own data too.
  const [refreshTick, setRefreshTick] = createSignal(0);

  const teamId = () => ws()?.team_id ?? "";
  const projectId = () => ws()?.project_id ?? "";
  const currentProject = () => ws()?.projects.find((p) => p.id === projectId());

  // Views tied to a team/project close when that selection changes (switch or fallback).
  const apply = (result: main.WorkspaceResult) => {
    handleProblem(result.error);
    setWsError(result.error?.message);
    if (!result.data) return;
    const prev = ws();
    if (prev && prev.team_id !== result.data.team_id && (pane() === "team-settings" || pane() === "project-settings")) {
      setPane("none");
    }
    if (prev && prev.project_id !== result.data.project_id && (pane() === "project-settings" || pane() === "request")) {
      setPane("none");
    }
    setWs(result.data);
  };

  const reloadWorkspace = async () => apply(await LoadWorkspace());

  const refreshInvitations = async () => {
    const result = await ListMyInvitations();
    handleProblem(result.error);
    setInvitationsError(result.error?.message);
    if (!result.error) setInvitations(result.data);
  };

  const refresh = async () => {
    setRefreshTick((n) => n + 1);
    await Promise.all([reloadWorkspace(), refreshInvitations()]);
  };

  const selectTeam = async (id: string) => {
    apply(await SelectTeam(id));
    setPane("none");
  };
  const selectProject = async (id: string) => apply(await SelectProject(id));

  // Coming back to the window is the natural "refresh" moment for an online-only client.
  const onFocus = () => void refresh();
  onMount(() => {
    void refresh();
    window.addEventListener("focus", onFocus);
  });
  onCleanup(() => window.removeEventListener("focus", onFocus));

  const logout = async () => {
    setLoggingOut(true);
    try {
      setAuthState(await Logout());
    } finally {
      setLoggingOut(false);
    }
  };

  const emptyText = () => {
    if (ws() === undefined) return "Loading…";
    if (!teamId()) return "Create a team to get started: Team ▾ → + New team.";
    return "Nothing open. Requests will open here.";
  };

  return (
    <div class="main-screen">
      <header class="topbar">
        <div class="topbar-left">
          <strong class="brand">Ghostman</strong>
          <TeamSwitcher
            teams={ws()?.teams ?? []}
            currentId={teamId()}
            onOpen={refresh}
            onSelect={selectTeam}
            onCreated={selectTeam}
            onOpenSettings={() => setPane("team-settings")}
          />
          <span class="topbar-sep">/</span>
          <ProjectSwitcher
            teamId={teamId()}
            projects={ws()?.projects ?? []}
            currentId={projectId()}
            onOpen={refresh}
            onSelect={selectProject}
            onCreated={selectProject}
            onOpenSettings={() => setPane("project-settings")}
          />
          <button type="button" class="icon-button" title="Refresh from server" aria-label="Refresh"
            onClick={() => void refresh()}>↻</button>
        </div>
        <ProfileMenu
          invitationCount={invitations()?.length ?? 0}
          loggingOut={loggingOut()}
          onOpen={refreshInvitations}
          onInvitations={() => {
            setPane("invitations");
            void refreshInvitations();
          }}
          onSettings={props.onOpenSettings}
          onScratch={() => setPane("scratch")}
          onLogout={logout}
        />
      </header>
      <Show when={wsError()}>
        <p class="form-error banner">{wsError()}</p>
      </Show>
      <div class="shell">
        <Show when={currentProject()} fallback={<ProjectSidebar />}>
          {(project) => (
            <ProjectTree
              projectId={project().id}
              refreshTick={refreshTick()}
              selectedRequestId={pane() === "request" ? openRequestId() : undefined}
              onOpenRequest={(id) => {
                setOpenRequestId(id);
                setPane("request");
              }}
              onRequestGone={() => {
                if (pane() === "request") setPane("none");
              }}
            />
          )}
        </Show>
        <section class="pane">
          <Switch fallback={<div class="empty-pane"><p class="placeholder">{emptyText()}</p></div>}>
            <Match when={pane() === "team-settings" && teamId()}>
              {(id) => (
                <TeamSettingsView
                  teamId={id()}
                  refreshTick={refreshTick()}
                  onTeamChanged={() => void reloadWorkspace()}
                  onTeamGone={() => {
                    setPane("none");
                    void refresh();
                  }}
                />
              )}
            </Match>
            <Match when={pane() === "project-settings" && currentProject()}>
              {(project) => (
                <ProjectSettingsView
                  teamId={teamId()}
                  project={project()}
                  projects={ws()?.projects ?? []}
                  refreshTick={refreshTick()}
                  onChanged={() => void reloadWorkspace()}
                  onDeleted={() => {
                    setPane("none");
                    void reloadWorkspace();
                  }}
                />
              )}
            </Match>
            <Match when={pane() === "invitations"}>
              <InvitationsView
                invitations={invitations()}
                error={invitationsError()}
                onChanged={refreshInvitations}
                onAccepted={async (id) => {
                  await refreshInvitations();
                  await selectTeam(id);
                }}
              />
            </Match>
            <Match when={pane() === "request" && openRequestId()}>
              {(id) => <RequestPlaceholder requestId={id()} refreshTick={refreshTick()} />}
            </Match>
            <Match when={pane() === "scratch"}>
              <ScratchView />
            </Match>
          </Switch>
        </section>
      </div>
    </div>
  );
}
