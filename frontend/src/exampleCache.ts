// Per-request example summaries and counts, as last fetched from the server — what
// the sidebar tree shows under a request (chevron for count > 0, child rows once
// expanded) and the "Examples (N)" sub-tab label. Counts arrive with every request
// list (example_count) and GetRequest; the summaries are LAZY: fetched on the
// first expand (one ListExamples per request, deduped while in flight) and kept
// until they are known to be stale:
//   - a newer count disagrees with the cached list (a teammate added / deleted),
//   - an example of that request changed here (refresh),
//   - an explicit refresh (↻ / window focus: invalidateAll).
// Nothing is patched locally: every value is a server answer.
import { createSignal } from "solid-js";

export interface ExampleSummaryLike {
  id: string;
  name: string;
  status: number;
}

export interface ExampleCache<T extends ExampleSummaryLike> {
  count: (requestId: string) => number | undefined; // reactive
  list: (requestId: string) => readonly T[] | undefined; // reactive; undefined = not loaded
  setCount: (requestId: string, n: number) => void;
  setCounts: (counts: Iterable<[string, number]>) => void;
  setList: (requestId: string, list: readonly T[]) => void; // a fresh server list (count follows)
  ensure: (requestId: string) => Promise<void>; // load once
  refresh: (requestId: string) => Promise<void>; // re-fetch now
  invalidateAll: () => void;
  // The request an example belongs to, among the loaded lists.
  ownerOf: (exampleId: string) => string | undefined;
}

export function createExampleCache<T extends ExampleSummaryLike>(
  load: (requestId: string) => Promise<readonly T[] | undefined>,
): ExampleCache<T> {
  const [counts, setCountsMap] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [lists, setLists] = createSignal<ReadonlyMap<string, readonly T[]>>(new Map());
  const inflight = new Map<string, Promise<void>>();
  let generation = 0; // bumped by invalidateAll: answers from before are dropped

  const dropList = (ids: string[]) => {
    const cur = lists();
    if (!ids.some((id) => cur.has(id))) return;
    const next = new Map(cur);
    for (const id of ids) next.delete(id);
    setLists(next);
  };

  const setCounts = (entries: Iterable<[string, number]>) => {
    const cur = counts();
    let next: Map<string, number> | undefined;
    const stale: string[] = [];
    for (const [id, n] of entries) {
      if (cur.get(id) !== n) (next ??= new Map(cur)).set(id, n);
      const l = lists().get(id);
      if (l && l.length !== n) stale.push(id);
    }
    if (next) setCountsMap(next);
    dropList(stale);
  };

  const setList = (requestId: string, list: readonly T[]) => {
    const next = new Map(lists());
    next.set(requestId, list);
    setLists(next);
    setCounts([[requestId, list.length]]);
  };

  const fetch = (requestId: string): Promise<void> => {
    const gen = generation;
    const p = load(requestId).then((list) => {
      if (list && gen === generation) setList(requestId, list);
    }).finally(() => {
      if (inflight.get(requestId) === p) inflight.delete(requestId);
    });
    inflight.set(requestId, p);
    return p;
  };

  return {
    count: (id) => counts().get(id),
    list: (id) => lists().get(id),
    setCount: (id, n) => setCounts([[id, n]]),
    setCounts,
    setList,
    ensure: (id) => (lists().has(id) ? Promise.resolve() : inflight.get(id) ?? fetch(id)),
    refresh: (id) => fetch(id),
    invalidateAll: () => {
      generation++;
      inflight.clear();
      setLists(new Map());
    },
    ownerOf: (exampleId) => {
      for (const [rid, l] of lists()) if (l.some((e) => e.id === exampleId)) return rid;
      return undefined;
    },
  };
}
