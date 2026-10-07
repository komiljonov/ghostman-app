// Tells an open History tab that the history changed elsewhere (a send finished,
// Settings cleared or pruned it), so it re-fetches its first page. The data stays
// in Go/SQLite; this is only a change counter.
import { createSignal } from "solid-js";

const [tick, setTick] = createSignal(0);

export const historyTick = tick;
export const historyChanged = () => setTick((n) => n + 1);

// A request's History sub-tab asks the History tab to show that request's sends
// (and optionally select one entry). The History tab consumes it once.
export interface HistoryFocus {
  requestId: string;
  requestName: string;
  entryId?: number;
}

const [focus, setFocus] = createSignal<HistoryFocus>();

export const historyFocus = focus;
export const focusHistory = (f: HistoryFocus) => setFocus({ ...f });
export const consumeHistoryFocus = () => setFocus(undefined);
