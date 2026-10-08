import { createStore, produce, unwrap } from "solid-js/store";
import {
  CancelRequest, EvalResponseFilter, GetLayout, GetRequest, ReleaseResponse, SaveRequest, SendRequest, SetLayout,
} from "../wailsjs/go/main/App";
import { api, engine, main } from "../wailsjs/go/models";
import { handleProblem } from "./authStore";
import { historyChanged } from "./historyStore";
import { Autosaver, createAutosaver, SaveState } from "./autosave";
import { BodyView, defaultView } from "./responseView";
import type { SavedSearch } from "./responseSearch";
import { afterEval, FilterState, NO_FILTER, shouldAutoApply } from "./responseFilter";
import { adoptUrlQuery } from "./urlParams";
import { AuthConfig, normalizeAuth } from "./auth";
import { sourceLabel, type ResolvedAuth } from "./settingsResolver";
import { Row } from "./rows";
import { createLayoutSaver, LayoutStorage, restoreLayout, saveLayout } from "./layoutPersistence";
import {
  activateTab, activeTab, allGroups, allTabs, closeTab, enforceMinimums, findGroup, focusedGroup, focusGroup, groupOf, Layout,
  moveTab, openTab, resetSizes, resize, Side, singleGroup, splitGroup,
} from "./layoutTree";
import { applyDrop, DropTarget } from "./dropZone";
import { closeEach, CloseMode, cycleKey, ENV_LIST, HISTORY, syncEnvTabs, TabKind, TabRef, tabKey, tabsToClose } from "./tabModel";

export const AUTOSAVE_DELAY_MS = 600;

export interface Body {
  type: string; // none | raw | form
  content_type: string;
  content: string;
  fields: Row[];
}

// The editable part of a request (mirrors api.RequestDraft).
export interface Draft {
  method: string;
  url: string;
  headers: Row[];
  query_params: Row[];
  body: Body;
  auth: AuthConfig; // the request's own auth setting (cascades: settingsResolver.resolveAuth)
  response_filter: string; // jq query for the response view (synced; "" = none)
}

export interface TabState {
  kind: TabKind;
  id: string; // request id, environment id, or "" for the environment list
  key: string; // tabKey({kind, id}): unique within the tab bar
  name: string;
  status: "loading" | "ready" | "error";
  loadError?: string;
  draft: Draft;
  save: SaveState;
  saveError?: string;
  sending: boolean;
  response?: engine.Response;
  responseError?: string;
  // {{keys}} the last send could not resolve (sent literally).
  unresolved: string[];
  // View state (not saved anywhere).
  section: "params" | "headers" | "body" | "auth" | "settings" | "history";
  responseSection: "body" | "headers";
  // Pretty | Raw | Preview; reset to the response's default on every new response.
  responseView: BodyView;
  // Collapsed JSON nodes of the Pretty view; cleared by every new response.
  responseFolds?: { from: number; to: number }[];
  // The response filter bar's result (the query itself is draft.response_filter).
  filter: FilterState;
  // The open response search (query, case, selected match), restored when the
  // body mounts again — switching tabs or views must not lose it. Kept across
  // sends (it re-runs on the new body); cleared when the search is closed.
  responseSearch?: SavedSearch;
  // Timing of the last send's hops (also after a failed send); reset by every send.
  hops: engine.Hop[];
  responseShare: number; // fraction of the editor height given to the response
}

const emptyDraft = (): Draft => ({
  method: "GET", url: "", headers: [], query_params: [], body: { type: "none", content_type: "application/json", content: "", fields: [] },
  auth: normalizeAuth(),
  response_filter: "",
});

function draftFromRequest(r: api.Request): Draft {
  return {
    method: r.method,
    url: r.url,
    headers: (r.headers ?? []).map((h) => ({ ...h })),
    query_params: (r.query_params ?? []).map((q) => ({ ...q })),
    body: {
      type: r.body?.type || "none",
      content_type: r.body?.content_type || "application/json",
      content: r.body?.content ?? "",
      fields: (r.body?.fields ?? []).map((f) => ({ ...f })),
    },
    auth: normalizeAuth(r.auth),
    response_filter: r.response_filter ?? "",
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const layoutStorage: LayoutStorage = {
  get: (projectId) => GetLayout(projectId),
  set: (projectId, json) => SetLayout(projectId, json),
};

export interface TabsHooks {
  // A save changed something the tree shows (the method badge).
  onTreeStale: () => void;
  // The resolved follow-redirects value for a request (cascading setting, resolved
  // in the UI from the tree store + the global value).
  followRedirects: (requestId: string) => boolean;
  // The effective auth of a request from its draft's own config + its folders.
  auth: (requestId: string, own: AuthConfig) => ResolvedAuth;
}

export type TabsController = ReturnType<typeof createTabsController>;

// Tabs of one project. Created when the project is selected, disposed (after
// flushing pending saves) when another project is selected.
export function createTabsController(projectId: string, hooks: TabsHooks) {
  // tabs: every open tab's state (any order); layout: which group shows which tabs,
  // in what order, and the split tree (layoutTree.ts). Savers/bases are keyed by
  // request id (request tabs only).
  const [state, setState] = createStore<{ tabs: TabState[]; layout: Layout; restored: boolean }>({
    tabs: [], layout: singleGroup(), restored: false,
  });
  const savers = new Map<string, Autosaver>();
  const bases = new Map<string, Draft>(); // last saved state per tab
  const closing = new Map<string, Draft>(); // drafts of closed tabs whose final save is still pending
  let disposed = false;

  // Request-tab helpers take the request id; tab-bar operations take the tab key.
  const tab = (id: string) => state.tabs.find((t) => t.kind === "request" && t.id === id);
  const byKey = (key: string) => state.tabs.find((t) => t.key === key);
  const update = (id: string, fn: (t: TabState) => void) =>
    setState("tabs", (t) => t.kind === "request" && t.id === id, produce(fn));
  const updateKey = (key: string, fn: (t: TabState) => void) => setState("tabs", (t) => t.key === key, produce(fn));
  const refOf = (t: TabState): TabRef => ({ kind: t.kind, id: t.id });
  // The layout is saved (debounced 300 ms) after every change, flushed on quit.
  const layoutSaver = createLayoutSaver(() => saveLayout(layoutStorage, projectId, unwrap(state.layout)));
  const setLayout = (next: Layout) => {
    setState("layout", next);
    if (state.restored) layoutSaver.change();
  };

  const newTab = (ref: TabRef, name: string, status: TabState["status"]): TabState => ({
    kind: ref.kind, id: ref.id, key: tabKey(ref), name, status, draft: emptyDraft(), save: "idle", sending: false,
    unresolved: [], filter: NO_FILTER, section: "params", responseSection: "body", responseView: "raw", responseShare: 0.45,
    hops: [],
  });
  const addTab = (ref: TabRef, name: string, status: TabState["status"]) => {
    if (byKey(tabKey(ref))) return;
    setState("tabs", (tabs) => [...tabs, newTab(ref, name, status)]);
  };
  const addLoadingTab = (id: string) => addTab({ kind: "request", id }, "", "loading");

  const makeSaver = (id: string) =>
    createAutosaver({
      delayMs: AUTOSAVE_DELAY_MS,
      onState: (s) => update(id, (t) => {
        t.save = s;
        if (s !== "error") t.saveError = undefined;
      }),
      save: async () => {
        const live = tab(id);
        const draft = live ? unwrap(live.draft) : closing.get(id);
        const base = bases.get(id);
        if (!draft || !base) return true;
        const snapshot = clone(draft);
        const result = await SaveRequest(id, api.RequestDraft.createFrom(base), api.RequestDraft.createFrom(snapshot));
        handleProblem(result.error);
        if (result.error) {
          if (live) update(id, (t) => (t.saveError = result.error!.message));
          return false;
        }
        bases.set(id, snapshot);
        // The tree shows the method badge and holds every node's auth (for the cascade).
        if (snapshot.method !== base.method || JSON.stringify(snapshot.auth) !== JSON.stringify(base.auth)) hooks.onTreeStale();
        return true;
      },
    });

  // Loads a tab's request; false when it is gone (404) so restore can drop it.
  const load = async (id: string): Promise<boolean> => {
    const result = await GetRequest(id);
    handleProblem(result.error);
    if (disposed) return false;
    if (!result.data) {
      update(id, (t) => {
        t.status = "error";
        t.loadError = result.error?.message;
      });
      return result.error?.status !== 404;
    }
    // The base is what the server has; the draft may differ only by a legacy query
    // moved out of `url` into the rows (saved with the next edit, see urlParams.ts).
    const loaded = draftFromRequest(result.data);
    bases.set(id, clone(loaded));
    const adopted = adoptUrlQuery(loaded.url, loaded.query_params);
    const draft = { ...loaded, url: adopted.url, query_params: adopted.rows };
    savers.set(id, makeSaver(id));
    update(id, (t) => {
      t.status = "ready";
      t.name = result.data!.name;
      t.draft = draft;
      t.save = "idle";
    });
    return true;
  };

  const removeTab = (key: string) => {
    if (!byKey(key)) return;
    setState("tabs", (tabs) => tabs.filter((t) => t.key !== key));
    setLayout(closeTab(state.layout, key));
  };
  const requestKey = (id: string) => tabKey({ kind: "request", id });
  const ENV_LIST_NAME = "Environments";
  const HISTORY_NAME = "History";
  const fixedName = (ref: TabRef) => (ref.kind === "env_list" ? ENV_LIST_NAME : ref.kind === "history" ? HISTORY_NAME : "");

  // The active tab of the focused group (what Send / Ctrl+W / the tree follow).
  const activeKey = () => activeTab(state.layout) ?? undefined;
  // Switching away from a request tab flushes its pending edits (as before).
  const flushIfLeaving = (next: Layout) => {
    for (const g of allGroups(state.layout.root)) {
      const after = findGroup(next.root, g.id)?.activeTabId;
      if (!g.activeTabId || after === g.activeTabId) continue;
      const t = byKey(g.activeTabId);
      if (t?.kind === "request") void savers.get(t.id)?.flush();
    }
  };
  const apply = (next: Layout) => {
    flushIfLeaving(next);
    setLayout(next);
  };
  const openRef = (ref: TabRef, name: string, status: TabState["status"]) => {
    addTab(ref, name, status);
    apply(openTab(state.layout, tabKey(ref)));
  };

  const controller = {
    state,
    activeKey,
    active: () => {
      const k = activeKey();
      return k ? byKey(k) : undefined;
    },
    activeKind: (): TabKind | undefined => {
      const k = activeKey();
      return k ? byKey(k)?.kind : undefined;
    },
    // The active request tab's id (for the tree's selection highlight).
    activeRequestId: () => {
      const k = activeKey();
      const t = k ? byKey(k) : undefined;
      return t?.kind === "request" ? t.id : undefined;
    },
    isActive: (ref: TabRef) => activeKey() === tabKey(ref),
    tabByKey: byKey,
    groups: () => allGroups(state.layout.root),
    group: (id: string) => findGroup(state.layout.root, id),

    async restore() {
      const restored = await restoreLayout(layoutStorage, projectId, async (ref) => {
        if (ref.kind !== "request") {
          // Env tabs are checked against the environment list by syncWithEnvs.
          addTab(ref, fixedName(ref), "ready");
          return true;
        }
        addLoadingTab(ref.id);
        const ok = await load(ref.id);
        // A disposed controller must not report tabs as gone (that would erase them).
        return disposed || ok;
      });
      if (disposed) return;
      const keep = new Set(allTabs(restored.root));
      setState("tabs", (tabs) => tabs.filter((t) => keep.has(t.key)));
      setState("layout", restored);
      setState("restored", true);
    },

    // Opens (or reveals) a request tab: in the focused group when it is not open yet.
    open(id: string) {
      if (!tab(id)) {
        addLoadingTab(id);
        void load(id);
      }
      apply(openTab(state.layout, requestKey(id)));
    },

    openEnv(id: string, name: string) {
      openRef({ kind: "env", id }, name, "ready");
    },

    openEnvList() {
      openRef(ENV_LIST, ENV_LIST_NAME, "ready");
    },

    openHistory() {
      openRef(HISTORY, HISTORY_NAME, "ready");
    },

    // Activates a tab in its group and focuses that group.
    activate(key: string) {
      apply(activateTab(state.layout, key));
    },

    focusGroup(id: string) {
      if (state.layout.focusedGroupId !== id) setLayout(focusGroup(state.layout, id));
    },

    // Ctrl/Cmd+1..9: the n-th group in visual order (left→right, top→bottom).
    focusGroupAt(n: number) {
      const g = allGroups(state.layout.root)[n - 1];
      if (g) controller.focusGroup(g.id);
    },

    async close(key: string) {
      const target = byKey(key);
      if (!target) return;
      if (target.kind !== "request") {
        removeTab(key); // the env view unmounts and flushes its pending edits
        return;
      }
      const id = target.id;
      const saver = savers.get(id);
      savers.delete(id);
      closing.set(id, clone(unwrap(target.draft)));
      void CancelRequest(id);
      void ReleaseResponse(id); // the full body kept Go-side for "Save to file"
      removeTab(key);
      await saver?.flush(); // pending edits still reach the server
      saver?.dispose();
      closing.delete(id);
      bases.delete(id);
    },

    // Tab context menu: Close / Close Others / Close All — within the tab's group,
    // each through close() (which flushes that tab's pending edits).
    async closeMany(target: string, mode: CloseMode) {
      const g = groupOf(state.layout.root, target);
      if (!g) return;
      await closeEach(tabsToClose([...g.tabs], target, mode), (k) => controller.close(k));
    },

    // Ctrl+Tab / Ctrl+Shift+Tab: next/previous tab of the FOCUSED group, wrapping.
    cycle(dir: 1 | -1) {
      const g = focusedGroup(state.layout);
      const next = cycleKey(g.tabs, g.activeTabId ?? undefined, dir);
      if (next && next !== g.activeTabId) controller.activate(next);
    },

    // Drag & drop (dropZone.ts): reorder, move to another group, or split.
    drop(key: string, target: DropTarget) {
      const next = applyDrop(state.layout, key, target);
      if (next) apply(next);
    },

    // Split Right / Split Down (menu, Ctrl+\): the tab moves into a new group
    // beside its own. Its group's only tab: the group just moves aside.
    split(key: string, side: Side) {
      const g = groupOf(state.layout.root, key);
      if (g) apply(splitGroup(state.layout, g.id, side, key));
    },

    // Move to Group N (menu).
    moveToGroup(key: string, groupId: string) {
      apply(moveTab(state.layout, key, groupId));
    },

    // Sash drag / double-click (sizes as fractions; minimums enforced by layoutTree).
    resize(splitId: string, index: number, delta: number, mins: number[]) {
      setLayout(resize(state.layout, splitId, index, delta, mins));
    },
    resetSizes(splitId: string) {
      setLayout(resetSizes(state.layout, splitId));
    },
    // Sizes below the minimums for the current window are lifted ON SCREEN only:
    // not saved by itself (a small window must not rewrite the stored proportions
    // for good); the next real layout change saves whatever is shown.
    fitTo(widthPx: number, heightPx: number) {
      const next = enforceMinimums(unwrap(state.layout), widthPx, heightPx);
      if (JSON.stringify(next) !== JSON.stringify(unwrap(state.layout))) setState("layout", next);
    },

    // Applies an edit to a tab's draft and schedules an autosave.
    edit(id: string, fn: (d: Draft) => void) {
      if (tab(id)?.status !== "ready") return;
      update(id, (t) => fn(t.draft));
      savers.get(id)?.change();
    },

    // View-only changes (sub-tab, wrap, split): never saved.
    view(id: string, fn: (t: TabState) => void) {
      update(id, fn);
    },

    retrySave: (id: string) => savers.get(id)?.retry(),


    async send(id: string) {
      const current = tab(id);
      if (!current || current.status !== "ready" || current.sending) return;
      update(id, (t) => {
        t.sending = true;
        t.responseError = undefined;
        t.hops = [];
      });
      await savers.get(id)?.flush(); // send what is saved
      const snapshot = clone(unwrap(tab(id)!.draft));
      const auth = hooks.auth(id, snapshot.auth);
      const result = await SendRequest(
        projectId,
        id,
        api.RequestDraft.createFrom(snapshot),
        main.SendOptions.createFrom({
          follow_redirects: hooks.followRedirects(id), request_name: tab(id)!.name,
          auth: auth.config, auth_source: sourceLabel(auth.source),
        }),
      );
      handleProblem(result.error);
      historyChanged(); // every send is a new history entry (Go writes it)
      update(id, (t) => {
        t.sending = false;
        t.response = result.data ?? undefined;
        t.responseFolds = undefined;
        if (result.data) t.responseView = defaultView(result.data);
        t.responseError = result.error?.message;
        t.unresolved = result.unresolved ?? [];
        t.hops = result.hops ?? [];
        t.filter = NO_FILTER;
      });
      // A saved filter applies to the new response at once (✕ shows the full body).
      const saved = snapshot.response_filter;
      if (result.data && shouldAutoApply(saved, result.data)) {
        const r = await EvalResponseFilter(id, saved);
        update(id, (t) => {
          if (unwrap(t.response) === result.data) t.filter = afterEval(NO_FILTER, r); // not superseded
        });
      }
    },

    cancel: (id: string) => void CancelRequest(id),

    // Keeps tabs in line with the tree: renames relabel, deleted requests close.
    syncWithTree(requests: Map<string, { name: string }>) {
      if (!state.restored) return;
      for (const t of [...state.tabs]) {
        if (t.kind !== "request") continue;
        const node = requests.get(t.id);
        if (!node) {
          savers.get(t.id)?.dispose(); // the request is gone: nothing to save into
          void ReleaseResponse(t.id);
          savers.delete(t.id);
          removeTab(t.key);
        } else if (node.name !== t.name && t.status === "ready") {
          update(t.id, (x) => (x.name = node.name));
        }
      }
    },

    // Keeps env tabs in line with the project's environments: renames relabel,
    // deleted environments close.
    syncWithEnvs(envs: { id: string; name: string }[]) {
      if (!state.restored) return;
      const { rename, close } = syncEnvTabs(state.tabs.map((t) => ({ ref: refOf(t), name: t.name })), envs);
      for (const r of rename) updateKey(tabKey(r.ref), (t) => (t.name = r.name));
      for (const ref of close) removeTab(tabKey(ref));
    },

    async flushAll() {
      await Promise.all([...savers.values()].map((s) => s.flush()));
      await layoutSaver.flush(); // the last layout change is not lost on quit
    },

    // Project switch: flush pending saves in the background, then stop.
    dispose() {
      disposed = true;
      void layoutSaver.flush(); // project switch: write the pending layout
      // Responses are per tab and in memory: drop their Go-side full bodies too.
      for (const t of state.tabs) if (t.kind === "request") void ReleaseResponse(t.id);
      const pending = [...savers.values()];
      savers.clear();
      void Promise.all(pending.map((s) => s.flush())).then(() => pending.forEach((s) => s.dispose()));
    },
  };
  return controller;
}
