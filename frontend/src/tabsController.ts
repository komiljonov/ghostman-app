import { createStore, produce, unwrap } from "solid-js/store";
import {
  CancelRequest, GetRequest, GetTabs, ReleaseResponse, SaveRequest, SendRequest, SetTabs,
} from "../wailsjs/go/main/App";
import { api, engine, main } from "../wailsjs/go/models";
import { handleProblem } from "./authStore";
import { historyChanged } from "./historyStore";
import { Autosaver, createAutosaver, SaveState } from "./autosave";
import { BodyView, defaultView } from "./responseView";
import { adoptUrlQuery } from "./urlParams";
import { AuthConfig, normalizeAuth } from "./auth";
import { sourceLabel, type ResolvedAuth } from "./settingsResolver";
import { Row } from "./rows";
import { restoreTabs, saveTabs, TabStorage } from "./tabPersistence";
import { closeEach, CloseMode, cycleKey, ENV_LIST, HISTORY, reorder, sameTab, syncEnvTabs, TabKind, TabRef, tabKey, tabsToClose } from "./tabModel";

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
  // Timing of the last send's hops (also after a failed send); reset by every send.
  hops: engine.Hop[];
  responseShare: number; // fraction of the editor height given to the response
}

const emptyDraft = (): Draft => ({
  method: "GET", url: "", headers: [], query_params: [], body: { type: "none", content_type: "application/json", content: "", fields: [] },
  auth: normalizeAuth(),
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
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const storage: TabStorage = {
  get: (projectId) => GetTabs(projectId),
  set: (projectId, tabs) => SetTabs(projectId, main.Tabs.createFrom(tabs)),
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
  // activeKey: the active tab's key. Savers/bases are keyed by request id (request tabs only).
  const [state, setState] = createStore<{ tabs: TabState[]; activeKey?: string; restored: boolean }>({ tabs: [], restored: false });
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
  const persist = () => {
    const active = state.activeKey ? byKey(state.activeKey) : undefined;
    void saveTabs(storage, projectId, state.tabs.map(refOf), active ? refOf(active) : undefined);
  };

  const newTab = (ref: TabRef, name: string, status: TabState["status"]): TabState => ({
    kind: ref.kind, id: ref.id, key: tabKey(ref), name, status, draft: emptyDraft(), save: "idle", sending: false,
    unresolved: [], section: "params", responseSection: "body", responseView: "raw", responseShare: 0.45,
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
    const index = state.tabs.findIndex((t) => t.key === key);
    if (index < 0) return;
    const wasActive = state.activeKey === key;
    setState("tabs", (tabs) => tabs.filter((t) => t.key !== key));
    if (wasActive) {
      const next = state.tabs[Math.min(index, state.tabs.length - 1)];
      setState("activeKey", next?.key);
    }
  };
  const requestKey = (id: string) => tabKey({ kind: "request", id });
  const ENV_LIST_NAME = "Environments";
  const HISTORY_NAME = "History";
  const fixedName = (ref: TabRef) => (ref.kind === "env_list" ? ENV_LIST_NAME : ref.kind === "history" ? HISTORY_NAME : "");

  const controller = {
    state,
    active: () => (state.activeKey ? byKey(state.activeKey) : undefined),
    activeKind: (): TabKind | undefined => (state.activeKey ? byKey(state.activeKey)?.kind : undefined),
    // The active request tab's id (for the tree's selection highlight).
    activeRequestId: () => {
      const t = state.activeKey ? byKey(state.activeKey) : undefined;
      return t?.kind === "request" ? t.id : undefined;
    },
    isActive: (ref: TabRef) => {
      const t = state.activeKey ? byKey(state.activeKey) : undefined;
      return !!t && sameTab(refOf(t), ref);
    },

    async restore() {
      const saved = await restoreTabs(storage, projectId, async (ref) => {
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
      const keep = new Set(saved.open.map(tabKey));
      for (const t of [...state.tabs]) if (!keep.has(t.key)) removeTab(t.key);
      // Loads finish in any order: put the tabs back in their saved order.
      const order = saved.open.map(tabKey);
      setState("tabs", (tabs) => [...tabs].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)));
      setState("activeKey", saved.active ? tabKey(saved.active) : state.tabs[state.tabs.length - 1]?.key);
      setState("restored", true);
    },

    // Opens (or focuses) a request tab.
    open(id: string) {
      if (!tab(id)) {
        addLoadingTab(id);
        void load(id);
      }
      controller.activate(requestKey(id));
    },

    openEnv(id: string, name: string) {
      addTab({ kind: "env", id }, name, "ready");
      controller.activate(tabKey({ kind: "env", id }));
    },

    openEnvList() {
      addTab(ENV_LIST, ENV_LIST_NAME, "ready");
      controller.activate(tabKey(ENV_LIST));
    },

    openHistory() {
      addTab(HISTORY, HISTORY_NAME, "ready");
      controller.activate(tabKey(HISTORY));
    },

    activate(key: string) {
      const previous = state.activeKey ? byKey(state.activeKey) : undefined;
      if (previous && previous.key !== key && previous.kind === "request") {
        void savers.get(previous.id)?.flush(); // flush on tab switch
      }
      // (Env tabs flush their variable edits when their view unmounts.)
      setState("activeKey", key);
      persist();
    },

    async close(key: string) {
      const target = byKey(key);
      if (!target) return;
      if (target.kind !== "request") {
        removeTab(key); // the env view unmounts and flushes its pending edits
        persist();
        return;
      }
      const id = target.id;
      const saver = savers.get(id);
      savers.delete(id);
      closing.set(id, clone(unwrap(target.draft)));
      void CancelRequest(id);
      void ReleaseResponse(id); // the full body kept Go-side for "Save to file"
      removeTab(key);
      persist();
      await saver?.flush(); // pending edits still reach the server
      saver?.dispose();
      closing.delete(id);
      bases.delete(id);
    },

    // Tab context menu: Close / Close Others / Close All, each through close() (which
    // flushes that tab's pending edits and persists).
    async closeMany(target: string, mode: CloseMode) {
      await closeEach(tabsToClose(state.tabs.map((t) => t.key), target, mode), (k) => controller.close(k));
    },

    // Ctrl+Tab / Ctrl+Shift+Tab: next/previous tab in bar order, wrapping.
    cycle(dir: 1 | -1) {
      const next = cycleKey(state.tabs.map((t) => t.key), state.activeKey, dir);
      if (next && next !== state.activeKey) controller.activate(next);
    },

    // Drag & drop: move the tab at `from` to insertion slot `drop` (see tabModel.reorder).
    moveTab(from: number, drop: number) {
      const current = [...state.tabs];
      const next = reorder(current, from, drop);
      if (next === current) return;
      setState("tabs", next);
      persist();
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
      });
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
          persist();
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
      if (close.length > 0) persist();
    },

    async flushAll() {
      await Promise.all([...savers.values()].map((s) => s.flush()));
    },

    // Project switch: flush pending saves in the background, then stop.
    dispose() {
      disposed = true;
      // Responses are per tab and in memory: drop their Go-side full bodies too.
      for (const t of state.tabs) if (t.kind === "request") void ReleaseResponse(t.id);
      const pending = [...savers.values()];
      savers.clear();
      void Promise.all(pending.map((s) => s.flush())).then(() => pending.forEach((s) => s.dispose()));
    },
  };
  return controller;
}
