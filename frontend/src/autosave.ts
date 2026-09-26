// Per-tab autosave: debounce edits, run at most one save at a time, and make the
// last edit win. Pure orchestration — the caller supplies `save`, which reads the
// tab's *current* draft when called, so a save that starts late sends the latest
// state. Unit-tested with fake timers.

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaverOptions {
  delayMs: number;
  // Persist the current draft; resolve true on success, false on failure.
  save: () => Promise<boolean>;
  onState: (state: SaveState) => void;
}

export interface Autosaver {
  change: () => void; // an edit happened
  flush: () => Promise<void>; // save now if anything is unsaved, and wait until idle
  retry: () => Promise<void>; // after a failure
  dispose: () => void; // drop pending work without saving
  hasUnsaved: () => boolean;
}

export function createAutosaver(opts: AutosaverOptions): Autosaver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let dirty = false;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  // Runs saves until nothing is dirty. Never two at once: a caller that arrives
  // while a save is in flight waits for it, then saves again if more edits came in.
  const run = async (): Promise<void> => {
    while (running) await running;
    if (!dirty || disposed) return;
    dirty = false;
    opts.onState("saving");
    let ok = false;
    running = (async () => {
      ok = await opts.save().catch(() => false);
    })();
    try {
      await running;
    } finally {
      running = undefined;
    }
    if (disposed) return;
    if (!ok) {
      dirty = true; // keep the edits; retry() or the next change saves them
      opts.onState("error");
      return;
    }
    if (dirty) return run(); // edited while saving: last write wins
    opts.onState(timer !== undefined ? "pending" : "saved");
  };

  return {
    change() {
      if (disposed) return;
      dirty = true;
      clearTimer();
      opts.onState("pending");
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, opts.delayMs);
    },
    async flush() {
      clearTimer();
      await run();
    },
    async retry() {
      clearTimer();
      await run();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
    hasUnsaved: () => dirty || running !== undefined,
  };
}
