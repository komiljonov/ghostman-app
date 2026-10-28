// Per-request example counts for the "Examples (N)" sub-tab label, and a tick
// that tells an open Examples panel to re-fetch (after a save from the response
// pane or the history detail). Counts come from GetRequest (example_count) and
// from every list fetch; nothing is patched locally.
import { createSignal } from "solid-js";
import { ListExamples } from "../wailsjs/go/main/App";

const [counts, setCounts] = createSignal<ReadonlyMap<string, number>>(new Map());
const [tick, setTick] = createSignal(0);

export const exampleCount = (requestId: string) => counts().get(requestId);

export function setExampleCount(requestId: string, n: number) {
  if (counts().get(requestId) === n) return;
  const next = new Map(counts());
  next.set(requestId, n);
  setCounts(next);
}

// A request's examples changed elsewhere: open panels re-fetch.
export const examplesChanged = () => setTick(tick() + 1);

// After a save outside the panel: re-fetch that request's list for its badge.
export async function refreshExampleCount(requestId: string) {
  const r = await ListExamples(requestId);
  if (r.data) setExampleCount(requestId, r.data.length);
}
export const examplesTick = tick;
