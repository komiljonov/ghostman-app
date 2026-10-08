// Response filter bar rules (pure; unit-tested in responseFilter.test.ts). The
// query runs in Go (gojq over the full body Go holds: EvalResponseFilter /
// EvalHistoryFilter); this decides when the bar applies, what the viewer shows,
// and debounces evaluation while typing.
import { isJSONType, type ResponseLike } from "./responseView";

export const FILTER_DEBOUNCE_MS = 300;

export const FILTER_PLACEHOLDER = 'jq filter — e.g. .data[] | select(.status=="failed")';

export interface Availability {
  enabled: boolean;
  title: string;
}

// The bar is always present; it applies to JSON responses only (disabled, with
// the reason, otherwise — never hidden).
export function filterAvailability(resp: ResponseLike | undefined): Availability {
  if (!resp) return { enabled: false, title: "Send the request first" };
  if (resp.media) return { enabled: false, title: "JSON responses only" };
  if (resp.formatted || isJSONType(resp.contentType)) return { enabled: true, title: "Filter the response with a jq query" };
  return { enabled: false, title: "JSON responses only" };
}

// What Go returns (main.FilterResult).
export interface FilterResultLike {
  result_json: string;
  result_is_text: boolean;
  count: number;
  truncated: boolean;
  matched_note: string;
  error: string;
}

// Per tab (or per history detail): the last good result, the current error,
// and whether the result view is on (✕ turns it off; the query stays).
export interface FilterState {
  result?: FilterResultLike; // last successful evaluation
  error?: string; // the latest evaluation's error (mid-typing: normal)
  active: boolean;
}

export const NO_FILTER: FilterState = { active: false };

// The state after an evaluation of a (non-empty) query. Errors keep the last
// good result on screen, so typing a partial query never flickers to the full body.
export function afterEval(prev: FilterState, r: FilterResultLike): FilterState {
  if (r.error) return { result: prev.result, error: r.error, active: prev.result ? prev.active : false };
  return { result: r, active: true };
}

export type FilterDisplay =
  | { mode: "full" } // the response as received
  | { mode: "result"; text: string; structured: boolean; note: string }
  | { mode: "empty"; note: string }; // the query matched nothing

export function filterDisplay(s: FilterState): FilterDisplay {
  if (!s.active || !s.result) return { mode: "full" };
  const r = s.result;
  if (r.count === 0) return { mode: "empty", note: r.matched_note || "no matches" };
  // A capped result cannot be parsed for the collapsible view: flat text.
  return { mode: "result", text: r.result_json, structured: !r.result_is_text && !r.truncated, note: r.matched_note };
}

// A new response for a request with a saved filter: apply it at once.
export const shouldAutoApply = (savedQuery: string, resp: ResponseLike | undefined) =>
  savedQuery.trim() !== "" && filterAvailability(resp).enabled;

// Save: with a result showing, the save button offers Full body (default) or the
// filtered result; otherwise it saves the full body directly.
export function saveChoices(s: FilterState): { id: "full" | "filtered"; label: string; enabled: boolean }[] | null {
  if (filterDisplay(s).mode !== "result") return null;
  return [
    { id: "full", label: "Full body", enabled: true },
    { id: "filtered", label: "Filtered result", enabled: true },
  ];
}

// The help popover's examples (static).
export const FILTER_EXAMPLES: { query: string; what: string }[] = [
  { query: ".data[]", what: "every item of an array" },
  { query: '.data[] | select(.status == "failed")', what: "items where a field matches" },
  { query: ".data[] | {id, name}", what: "pick fields" },
  { query: ".data | sort_by(.revenue) | reverse", what: "sort (descending)" },
  { query: ".data | length", what: "count" },
  { query: ".meta.pagination.next", what: "drill into nested objects" },
];

// Where to learn the query language (opened in the system browser). gojq follows
// jq's manual; the differences are minor (e.g. keys come out sorted).
export const FILTER_DOCS: { label: string; url: string; what: string }[] = [
  { label: "jq manual", url: "https://jqlang.org/manual/", what: "every filter and function, with examples" },
  { label: "jq tutorial", url: "https://jqlang.org/tutorial/", what: "a short walk-through" },
];

// Debounced evaluation: schedule() waits FILTER_DEBOUNCE_MS after the last
// keystroke, now() runs at once (Enter, auto-apply); answers to superseded
// queries are dropped (typing fast never shows an older result).
export function createFilterRunner<R>(
  run: (query: string) => Promise<R>,
  apply: (query: string, result: R) => void,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
) {
  let handle: unknown;
  let seq = 0;
  const fire = async (query: string) => {
    const mine = ++seq;
    const result = await run(query);
    if (mine === seq) apply(query, result);
  };
  return {
    schedule(query: string) {
      timers.clear(handle);
      seq++; // anything in flight is now stale
      handle = timers.set(() => void fire(query), FILTER_DEBOUNCE_MS);
    },
    now(query: string) {
      timers.clear(handle);
      return fire(query);
    },
    cancel() {
      timers.clear(handle);
      seq++;
    },
  };
}
