// Per-request example counts and (lazy) summaries — the "Examples (N)" sub-tab
// label and the sidebar tree's example rows (rules in exampleCache.ts) — and a
// tick that tells an open Examples panel to re-fetch. Counts come from the request
// list, GetRequest (example_count) and every list fetch; nothing is patched locally.
import { createSignal } from "solid-js";
import { ListExamples } from "../wailsjs/go/main/App";
import type { api } from "../wailsjs/go/models";
import { createExampleCache } from "./exampleCache";

const cache = createExampleCache<api.ExampleSummary>(async (requestId) => (await ListExamples(requestId)).data ?? undefined);
const [tick, setTick] = createSignal(0);

export const exampleCount = cache.count;
export const exampleList = cache.list;
export const setExampleCount = cache.setCount;
export const setExampleCounts = cache.setCounts; // from every request list (ProjectTree)
export const setExampleList = cache.setList; // a panel's own fetch
export const ensureExamples = cache.ensure; // the tree's first expand
export const invalidateExampleLists = cache.invalidateAll; // ↻ / window focus
export const exampleOwner = cache.ownerOf;

// A request's examples changed elsewhere: open panels re-fetch.
export const examplesChanged = () => setTick(tick() + 1);

// After a save / rename / delete outside the panel: re-fetch that request's list
// (its count and tree rows), and tell open panels.
export async function examplesChangedFor(requestId: string) {
  examplesChanged();
  await cache.refresh(requestId);
}
export const examplesTick = tick;
