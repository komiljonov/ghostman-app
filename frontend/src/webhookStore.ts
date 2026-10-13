// Webhook capture state shared by the sidebar panel, the webhook tabs and the
// tab bar: the project's endpoint list, the server's capture domains, and one
// polled feed per OPEN webhook tab (rules: webhookPoll.ts). Feeds live here, not
// in the tab component, because editor groups mount only their active tab — a
// tab in the background must keep listening.
import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { GetWebhookMeta, ListWebhooks, PollCaptures } from "../wailsjs/go/main/App";
import type { api } from "../wailsjs/go/models";
import { handleProblem } from "./authStore";
import { applyPage, clearedFeed, createPoller, emptyFeed, failPoll, Feed } from "./webhookPoll";

export type CaptureFeed = Feed<api.CaptureSummary>;

// ---- Endpoint list + meta (re-fetched after every mutation) ----

const [hooks, setHooks] = createSignal<api.Webhook[]>([]);
const [hooksLoaded, setHooksLoaded] = createSignal(false);
const [hooksError, setHooksError] = createSignal<string>();
const [domains, setDomains] = createSignal<string[]>([]);
const [metaLoaded, setMetaLoaded] = createSignal(false);
let listProject = "";
let listSeq = 0;

export { hooks as webhooks, hooksLoaded as webhooksLoaded, hooksError as webhooksError, domains as hookDomains, metaLoaded as hookMetaLoaded };

// Loads the project's endpoints and the server's capture domains.
export async function loadWebhooks(projectId: string): Promise<void> {
  if (projectId !== listProject) {
    listProject = projectId;
    setHooks([]);
    setHooksLoaded(false);
  }
  const mine = ++listSeq;
  const [list, meta] = await Promise.all([ListWebhooks(projectId), GetWebhookMeta()]);
  if (mine !== listSeq) return;
  handleProblem(list.error ?? meta.error);
  if (meta.data) {
    setDomains(meta.data.hooks_domains ?? []);
    setMetaLoaded(true);
  }
  setHooksError(list.error?.message);
  if (list.data) {
    setHooks(list.data);
    setHooksLoaded(true);
  }
}

export const reloadWebhooks = () => (listProject ? loadWebhooks(listProject) : Promise.resolve());

// ---- Feeds (one per open webhook tab) ----

const [feeds, setFeeds] = createStore<Record<string, CaptureFeed>>({});
const [focused, setFocused] = createSignal(typeof document === "undefined" ? true : document.hasFocus());
const pinned = new Map<string, boolean>(); // the capture list is scrolled to its top (default)

let isVisible: (id: string) => boolean = () => false;
let gone: (id: string) => void = () => undefined;

const poller = createPoller<api.CaptureSummary>({
  poll: async (id, after) => {
    const r = await PollCaptures(id, after);
    handleProblem(r.error);
    return r;
  },
  cursor: (id) => feeds[id]?.cursor ?? 0,
  onPage: (id, page) => {
    if (!feeds[id]) return;
    setFeeds(id, (f) => applyPage(f, page, { visible: isVisible(id), pinned: pinned.get(id) ?? true }));
  },
  onError: (id, message) => feeds[id] && setFeeds(id, (f) => failPoll(f, message)),
  onGone: (id) => gone(id),
  focused: () => focused(),
});

let listening = false;
function listenToWindow() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Minimizing or switching away blurs the window: polling pauses, and the
  // first thing on return is a catch-up poll.
  window.addEventListener("focus", () => {
    setFocused(true);
    poller.setFocused(true);
  });
  window.addEventListener("blur", () => {
    setFocused(false);
    poller.setFocused(false);
  });
}

// Keeps the polled set equal to the open webhook tabs. visible(id): the tab is
// shown (its group's active tab); onGone(id): the endpoint was deleted (404).
export function syncFeeds(ids: readonly string[], opts: { visible: (id: string) => boolean; onGone: (id: string) => void }) {
  listenToWindow();
  isVisible = opts.visible;
  gone = opts.onGone;
  const want = new Set(ids);
  setFeeds(produce((all) => {
    for (const id of Object.keys(all)) if (!want.has(id)) delete all[id];
    for (const id of want) if (!all[id]) all[id] = emptyFeed();
  }));
  for (const id of [...pinned.keys()]) if (!want.has(id)) pinned.delete(id);
  poller.sync([...want]);
}

export const feedOf = (id: string): CaptureFeed | undefined => feeds[id];

// Listening = the tab is open, the window has focus and the last poll succeeded.
export type ListenState = "listening" | "error" | "paused" | "off";
export function listenState(id: string): ListenState {
  const f = feeds[id];
  if (!f) return "off";
  if (!focused()) return "paused";
  return f.error ? "error" : "listening";
}

// The tab became visible: nothing is unseen any more.
export function markSeen(id: string) {
  if (feeds[id]?.unseen) setFeeds(id, "unseen", 0);
}

// The capture list scrolled: at the top, new rows just appear (the chip resets).
export function setPinned(id: string, atTop: boolean) {
  pinned.set(id, atTop);
  if (atTop && feeds[id]?.fresh) setFeeds(id, "fresh", 0);
}

// After "Clear all": empty list, then an immediate poll.
export function feedCleared(id: string) {
  if (!feeds[id]) return;
  setFeeds(id, (f) => clearedFeed(f));
  poller.pollNow(id);
}

// Logout / project switch: stop everything.
export function resetWebhooks() {
  poller.dispose();
  setFeeds(reconcile({}));
  pinned.clear();
  listProject = "";
  setHooks([]);
  setHooksLoaded(false);
}

// ---- Pending response-config edits (flushed on quit, like request autosaves) ----

const flushers = new Set<() => Promise<void>>();
export function registerWebhookFlush(fn: () => Promise<void>): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}
export const flushWebhookEdits = () => Promise.all([...flushers].map((f) => f())).then(() => undefined);

// UI state kept across remounts (editor groups mount only their active tab).
export const responseOpen = new Map<string, boolean>(); // "Response to senders" expanded
export const selectedCapture = new Map<string, number>(); // the capture shown in the detail
