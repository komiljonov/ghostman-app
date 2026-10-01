import { createStore, produce, unwrap } from "solid-js/store";
import { CancelRequest, GetRequest, GetTabs, SaveRequest, SendRequest, SetTabs } from "../wailsjs/go/main/App";
import { api, engine } from "../wailsjs/go/models";
import { handleProblem } from "./authStore";
import { Autosaver, createAutosaver, SaveState } from "./autosave";
import { Row } from "./rows";
import { restoreTabs, saveTabs, TabStorage } from "./tabPersistence";

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
}

export interface TabState {
  id: string; // the request id (one tab per request)
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
  section: "params" | "headers" | "body";
  responseSection: "body" | "headers";
  wrap: boolean;
  responseShare: number; // fraction of the editor height given to the response
}

const emptyDraft = (): Draft => ({
  method: "GET", url: "", headers: [], query_params: [], body: { type: "none", content_type: "application/json", content: "", fields: [] },
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
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const storage: TabStorage = {
  get: (projectId) => GetTabs(projectId),
  set: (projectId, tabs) => SetTabs(projectId, tabs),
};

export interface TabsHooks {
  // A save changed something the tree shows (the method badge).
  onTreeStale: () => void;
}

export type TabsController = ReturnType<typeof createTabsController>;

// Tabs of one project. Created when the project is selected, disposed (after
// flushing pending saves) when another project is selected.
export function createTabsController(projectId: string, hooks: TabsHooks) {
  const [state, setState] = createStore<{ tabs: TabState[]; activeId?: string; restored: boolean }>({ tabs: [], restored: false });
  const savers = new Map<string, Autosaver>();
  const bases = new Map<string, Draft>(); // last saved state per tab
  const closing = new Map<string, Draft>(); // drafts of closed tabs whose final save is still pending
  let disposed = false;

  const tab = (id: string) => state.tabs.find((t) => t.id === id);
  const update = (id: string, fn: (t: TabState) => void) =>
    setState("tabs", (t) => t.id === id, produce(fn));
  const persist = () => void saveTabs(storage, projectId, state.tabs.map((t) => t.id), state.activeId);

  const addLoadingTab = (id: string) => {
    if (tab(id)) return;
    setState("tabs", (tabs) => [...tabs, {
      id, name: "", status: "loading", draft: emptyDraft(), save: "idle", sending: false, unresolved: [],
      section: "params", responseSection: "body", wrap: true, responseShare: 0.45,
    } satisfies TabState]);
  };

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
        if (snapshot.method !== base.method) hooks.onTreeStale();
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
    const draft = draftFromRequest(result.data);
    bases.set(id, clone(draft));
    savers.set(id, makeSaver(id));
    update(id, (t) => {
      t.status = "ready";
      t.name = result.data!.name;
      t.draft = draft;
      t.save = "idle";
    });
    return true;
  };

  const removeTab = (id: string) => {
    const index = state.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const wasActive = state.activeId === id;
    setState("tabs", (tabs) => tabs.filter((t) => t.id !== id));
    if (wasActive) {
      const next = state.tabs[Math.min(index, state.tabs.length - 1)];
      setState("activeId", next?.id);
    }
  };

  const controller = {
    state,
    active: () => (state.activeId ? tab(state.activeId) : undefined),

    async restore() {
      const saved = await restoreTabs(storage, projectId, async (id) => {
        addLoadingTab(id);
        const ok = await load(id);
        // A disposed controller must not report tabs as gone (that would erase them).
        return disposed || ok;
      });
      if (disposed) return;
      for (const t of [...state.tabs]) if (!saved.open.includes(t.id)) removeTab(t.id);
      setState("activeId", saved.active || state.tabs[state.tabs.length - 1]?.id);
      setState("restored", true);
    },

    open(id: string) {
      if (!tab(id)) {
        addLoadingTab(id);
        void load(id);
      }
      controller.activate(id);
    },

    activate(id: string) {
      const previous = state.activeId;
      if (previous && previous !== id) void savers.get(previous)?.flush(); // flush on tab switch
      setState("activeId", id);
      persist();
    },

    async close(id: string) {
      const current = tab(id);
      const saver = savers.get(id);
      savers.delete(id);
      if (current) closing.set(id, clone(unwrap(current.draft)));
      void CancelRequest(id);
      removeTab(id);
      persist();
      await saver?.flush(); // pending edits still reach the server
      saver?.dispose();
      closing.delete(id);
      bases.delete(id);
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
      });
      await savers.get(id)?.flush(); // send what is saved
      const snapshot = clone(unwrap(tab(id)!.draft));
      const result = await SendRequest(projectId, id, api.RequestDraft.createFrom(snapshot));
      handleProblem(result.error);
      update(id, (t) => {
        t.sending = false;
        t.response = result.data ?? undefined;
        t.responseError = result.error?.message;
        t.unresolved = result.unresolved ?? [];
      });
    },

    cancel: (id: string) => void CancelRequest(id),

    // Keeps tabs in line with the tree: renames relabel, deleted requests close.
    syncWithTree(requests: Map<string, { name: string }>) {
      if (!state.restored) return;
      for (const t of [...state.tabs]) {
        const node = requests.get(t.id);
        if (!node) {
          savers.get(t.id)?.dispose(); // the request is gone: nothing to save into
          savers.delete(t.id);
          removeTab(t.id);
          persist();
        } else if (node.name !== t.name && t.status === "ready") {
          update(t.id, (x) => (x.name = node.name));
        }
      }
    },

    async flushAll() {
      await Promise.all([...savers.values()].map((s) => s.flush()));
    },

    // Project switch: flush pending saves in the background, then stop.
    dispose() {
      disposed = true;
      const pending = [...savers.values()];
      savers.clear();
      void Promise.all(pending.map((s) => s.flush())).then(() => pending.forEach((s) => s.dispose()));
    },
  };
  return controller;
}
