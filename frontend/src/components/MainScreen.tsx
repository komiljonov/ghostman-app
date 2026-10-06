import { createEffect, createMemo, createSignal, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { ConfirmQuit, ListMyInvitations, LoadWorkspace, Logout, SelectProject, SelectTeam } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { api, main, workspace } from "../../wailsjs/go/models";
import { handleProblem, setAuthState } from "../authStore";
import { createTabsController } from "../tabsController";
import { envContext, loadEnvContext, refreshEnvContext } from "../envStore";
import { canSendShortcut, canUseTabShortcut, shortcutAction } from "../tabModel";
import { runShortcut, setShortcutHandlers } from "../shortcuts";
import TeamSwitcher from "./TeamSwitcher";
import ProjectSwitcher from "./ProjectSwitcher";
import ProfileMenu from "./ProfileMenu";
import ProjectSidebar from "./ProjectSidebar";
import ProjectTree from "./ProjectTree";
import TeamSettingsView from "./TeamSettingsView";
import ProjectSettingsView from "./ProjectSettingsView";
import InvitationsView from "./InvitationsView";
import TabBar from "./TabBar";
import EnvSwitcher from "./EnvSwitcher";
import EnvListView from "./EnvListView";
import EnvVariablesView from "./EnvVariablesView";
import RequestEditor from "./RequestEditor";

interface Props {
  onOpenSettings: () => void;
}

// "editor" shows the open tabs — requests and environments — or the empty state.
type Pane = "editor" | "team-settings" | "project-settings" | "invitations";

// App shell (Postman-style): top bar with team/project switchers and profile menu,
// left sidebar for the project tree, main pane for whatever is open. The Go side
// owns the current team/project (persisted, validated on every load); this only
// renders the snapshot it returns and re-fetches after every change.
export default function MainScreen(props: Props) {
  const [ws, setWs] = createSignal<workspace.Workspace>();
  const [wsError, setWsError] = createSignal<string>();
  const [pane, setPane] = createSignal<Pane>("editor");
  const [invitations, setInvitations] = createSignal<api.MyInvitation[]>();
  const [invitationsError, setInvitationsError] = createSignal<string>();
  const [loggingOut, setLoggingOut] = createSignal(false);
  // Bumped on every refresh so open views re-fetch their own data too.
  const [refreshTick, setRefreshTick] = createSignal(0);
  // Bumped when a save changed something the tree shows (method badge).
  const [treeTick, setTreeTick] = createSignal(0);

  const teamId = () => ws()?.team_id ?? "";
  // A memo, so that refreshing the workspace (a new ws object with the same project)
  // does not look like a project switch to what depends on it (the tabs controller).
  const projectId = createMemo(() => ws()?.project_id ?? "");
  const currentProject = () => ws()?.projects.find((p) => p.id === projectId());

  // One tabs controller per selected project. Switching project disposes the old
  // one, which flushes its pending autosaves first.
  const tabs = createMemo(on(projectId, (id) => {
    if (!id) return undefined;
    const controller = createTabsController(id, { onTreeStale: () => setTreeTick((n) => n + 1) });
    void controller.restore();
    onCleanup(() => controller.dispose());
    return controller;
  }));

  // The env switcher / highlighting follow the selected project.
  createEffect(on(projectId, (id) => void loadEnvContext(id)));

  // Env tabs follow the environment list: renames relabel, deletes close.
  createEffect(() => {
    const ctx = envContext();
    const t = tabs();
    if (ctx && t && t.state.restored) t.syncWithEnvs(ctx.environments);
  });

  const openEnvTab = (id: string, name: string) => {
    tabs()?.openEnv(id, name);
    setPane("editor");
  };
  const openEnvList = () => {
    tabs()?.openEnvList();
    setPane("editor");
  };

  // Keyboard shortcuts, active regardless of focus: Ctrl/Cmd+Enter sends the active
  // request tab; Ctrl+Tab / Ctrl+Shift+Tab cycle tabs in bar order; Ctrl/Cmd+W closes
  // the active tab. One window-level handler; CodeMirror has its own highest-
  // precedence bindings to the same actions (and marks the event handled, so the
  // action never runs twice). All are no-ops while a modal is open.
  const modalOpen = () => !!document.querySelector(".modal-backdrop");
  const tabsUsable = () => pane() === "editor" && canUseTabShortcut({ modalOpen: modalOpen(), tabCount: tabs()?.state.tabs.length ?? 0 });
  setShortcutHandlers({
    send: () => {
      const t = tabs();
      const active = t?.active();
      if (!t || !active || pane() !== "editor") return;
      if (!canSendShortcut({ activeKind: active.kind, modalOpen: modalOpen(), sending: active.sending })) return;
      void t.send(active.id);
    },
    next: () => tabsUsable() && tabs()!.cycle(1),
    prev: () => tabsUsable() && tabs()!.cycle(-1),
    close: () => {
      const key = tabs()?.state.activeKey;
      if (tabsUsable() && key) void tabs()!.close(key);
    },
  });
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutAction(e);
      if (!action || e.defaultPrevented) return; // handled already (by a CodeMirror binding)
      e.preventDefault(); // the webview must not act on Ctrl+W / Ctrl+Tab itself
      runShortcut(action);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      setShortcutHandlers({});
    });
  });

  // Closing the window: Go asks us to flush autosaves first, then we confirm.
  onMount(() => {
    const off = EventsOn("app:before-close", async () => {
      await tabs()?.flushAll().catch(() => undefined);
      void ConfirmQuit();
    });
    onCleanup(off);
  });

  // Views tied to a team/project close when that selection changes (switch or fallback).
  const apply = (result: main.WorkspaceResult) => {
    handleProblem(result.error);
    setWsError(result.error?.message);
    if (!result.data) return;
    const prev = ws();
    if (prev && prev.team_id !== result.data.team_id && (pane() === "team-settings" || pane() === "project-settings")) {
      setPane("editor");
    }
    if (prev && prev.project_id !== result.data.project_id && pane() === "project-settings") setPane("editor");
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
    await Promise.all([reloadWorkspace(), refreshInvitations(), refreshEnvContext()]);
  };

  const selectTeam = async (id: string) => {
    apply(await SelectTeam(id));
    setPane("editor");
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
    return "Open a request from the sidebar.";
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
        <div class="topbar-right">
        <EnvSwitcher disabled={!projectId()} onEdit={openEnvTab} onManage={openEnvList} />
        <ProfileMenu
          invitationCount={invitations()?.length ?? 0}
          loggingOut={loggingOut()}
          onOpen={refreshInvitations}
          onInvitations={() => {
            setPane("invitations");
            void refreshInvitations();
          }}
          onSettings={props.onOpenSettings}
          onLogout={logout}
        />
        </div>
      </header>
      <Show when={wsError()}>
        <p class="form-error banner">{wsError()}</p>
      </Show>
      <div class="shell">
        <Show when={currentProject()} fallback={<ProjectSidebar />}>
          {(project) => (
            <ProjectTree
              projectId={project().id}
              refreshTick={refreshTick() + treeTick()}
              selectedRequestId={pane() === "editor" ? tabs()?.activeRequestId() : undefined}
              onOpenRequest={(id) => {
                tabs()?.open(id);
                setPane("editor");
              }}
              onLoaded={(pid, requests) => {
                if (pid === projectId()) tabs()?.syncWithTree(requests);
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
                    setPane("editor");
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
                    setPane("editor");
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
            <Match when={pane() === "editor" && tabs() && tabs()!.state.tabs.length > 0 && tabs()}>
              {(controller) => (
                <div class="editor-area">
                  <TabBar controller={controller()} />
                  <Show when={controller().active()} keyed>
                    {(tab) => (
                      <Switch>
                        <Match when={tab.kind === "request"}>
                          <RequestEditor tab={tab} controller={controller()} />
                        </Match>
                        <Match when={tab.kind === "env"}>
                          <EnvVariablesView envId={tab.id} />
                        </Match>
                        <Match when={tab.kind === "env_list"}>
                          <EnvListView projectId={projectId()} onOpenEnv={openEnvTab} />
                        </Match>
                      </Switch>
                    )}
                  </Show>
                </div>
              )}
            </Match>
          </Switch>
        </section>
      </div>
    </div>
  );
}
