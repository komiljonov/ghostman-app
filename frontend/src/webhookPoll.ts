// Polling of webhook captures (pure: no Solid, no bindings — webhookPoll.test.ts).
//
// Every OPEN webhook tab polls every POLL_INTERVAL_MS (also in a background
// group: a tab exists, its endpoint is listened to) with the highest capture id
// it has seen; the server answers what came after, oldest first. Polling pauses
// while the window does not have focus and resumes with an immediate poll when it
// gets it back. A 404 means the endpoint is gone (deleted elsewhere): onGone.

export const POLL_INTERVAL_MS = 2000;
export const MAX_FEED = 500; // captures kept per open tab (newest)

export interface CaptureLike {
  id: number;
}

export interface Feed<C extends CaptureLike = CaptureLike> {
  captures: C[]; // newest first
  cursor: number; // highest id seen (0 = nothing yet)
  loaded: boolean; // the first poll answered
  unseen: number; // arrived while the tab was not visible (tab + panel badge)
  fresh: number; // arrived while the list was scrolled away from the top ("N new" chip)
  error?: string; // the last poll failed (the dot turns amber; polling retries silently)
}

export const emptyFeed = <C extends CaptureLike>(): Feed<C> => ({ captures: [], cursor: 0, loaded: false, unseen: 0, fresh: 0 });

// Applies one poll answer (ascending). The first answer is the backlog: it is
// listed but neither unseen nor fresh. visible: the tab is shown (its group's
// active tab); pinned: the list is at its top (new rows simply appear there).
export function applyPage<C extends CaptureLike>(feed: Feed<C>, page: readonly C[], at: { visible: boolean; pinned: boolean }): Feed<C> {
  const added = page.filter((c) => c.id > feed.cursor);
  const cursor = added.reduce((m, c) => Math.max(m, c.id), feed.cursor);
  const n = feed.loaded ? added.length : 0;
  return {
    captures: [...[...added].reverse(), ...feed.captures].slice(0, MAX_FEED),
    cursor,
    loaded: true,
    unseen: at.visible ? 0 : feed.unseen + n,
    fresh: at.pinned ? 0 : feed.fresh + n,
    error: undefined,
  };
}

export const failPoll = <C extends CaptureLike>(feed: Feed<C>, message: string): Feed<C> => ({ ...feed, error: message });

// After "Clear all": the list empties but the cursor stays (ids only grow).
export const clearedFeed = <C extends CaptureLike>(feed: Feed<C>): Feed<C> => ({ ...feed, captures: [], unseen: 0, fresh: 0 });

export interface PollAnswer<C> {
  data?: C[] | null;
  error?: { status?: number; message: string } | null;
}

export interface PollerOptions<C extends CaptureLike> {
  intervalMs?: number;
  poll: (id: string, after: number) => Promise<PollAnswer<C>>;
  cursor: (id: string) => number;
  onPage: (id: string, page: C[]) => void;
  onError: (id: string, message: string) => void;
  onGone: (id: string) => void;
  focused: () => boolean; // the window has focus (initial state)
}

// One timer chain per listened id; at most one poll in flight per id.
export function createPoller<C extends CaptureLike>(opts: PollerOptions<C>) {
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout> | undefined>();
  const inFlight = new Set<string>();
  let focused = opts.focused();

  const schedule = (id: string) => {
    if (!timers.has(id) || !focused) return;
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => void tick(id), interval));
  };
  const tick = async (id: string) => {
    if (!timers.has(id) || !focused || inFlight.has(id)) return;
    inFlight.add(id);
    let answer: PollAnswer<C>;
    try {
      answer = await opts.poll(id, opts.cursor(id));
    } catch (e) {
      answer = { error: { message: String(e) } };
    }
    inFlight.delete(id);
    if (!timers.has(id)) return; // stopped while polling
    if (answer.error?.status === 404) {
      stop(id);
      opts.onGone(id);
      return;
    }
    if (answer.error) opts.onError(id, answer.error.message);
    else opts.onPage(id, answer.data ?? []);
    schedule(id);
  };
  const stop = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  const pollNow = (id: string) => {
    clearTimeout(timers.get(id));
    timers.set(id, undefined);
    void tick(id);
  };

  return {
    // The ids to listen to (the open webhook tabs): new ones poll at once.
    sync(ids: readonly string[]) {
      const want = new Set(ids);
      for (const id of [...timers.keys()]) if (!want.has(id)) stop(id);
      for (const id of want) if (!timers.has(id)) pollNow(id);
    },
    // Window focus: false pauses every chain; true polls each at once and resumes.
    setFocused(on: boolean) {
      if (on === focused) return;
      focused = on;
      for (const id of timers.keys()) {
        clearTimeout(timers.get(id));
        timers.set(id, undefined);
        if (on) void tick(id);
      }
    },
    // An immediate poll (after "Clear all", for instance).
    pollNow: (id: string) => timers.has(id) && pollNow(id),
    listening: (id: string) => timers.has(id) && focused,
    isFocused: () => focused,
    dispose() {
      for (const id of [...timers.keys()]) stop(id);
    },
  };
}
