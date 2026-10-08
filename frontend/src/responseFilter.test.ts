import { describe, expect, it, vi } from "vitest";
import {
  afterEval, createFilterRunner, FILTER_DEBOUNCE_MS, FILTER_DOCS, FILTER_EXAMPLES, filterAvailability, filterDisplay, FilterResultLike,
  NO_FILTER, saveChoices, shouldAutoApply,
} from "./responseFilter";
import type { ResponseLike } from "./responseView";

const json: ResponseLike = { contentType: "application/json", formatted: true, body: "{}" };
const ok = (over: Partial<FilterResultLike> = {}): FilterResultLike => ({
  result_json: "[\n  1\n]", result_is_text: false, count: 1, truncated: false, matched_note: "1 result · 9 B of 2.0 KB", error: "", ...over,
});
const err = (msg: string) => ok({ result_json: "", count: 0, matched_note: "", error: msg });

describe("availability (the bar is always there; disabled, not hidden)", () => {
  it("JSON responses only", () => {
    expect(filterAvailability(undefined)).toEqual({ enabled: false, title: "Send the request first" });
    expect(filterAvailability(json).enabled).toBe(true);
    expect(filterAvailability({ ...json, formatted: false, truncated: true }).enabled).toBe(true); // big JSON
    expect(filterAvailability({ contentType: "text/html", formatted: false, body: "<p>" })).toEqual({ enabled: false, title: "JSON responses only" });
    expect(filterAvailability({ contentType: "image/png", formatted: false, body: "", media: "image" }).title).toBe("JSON responses only");
  });
});

describe("evaluation state", () => {
  it("a result turns the result view on", () => {
    expect(afterEval(NO_FILTER, ok())).toEqual({ result: ok(), active: true });
  });
  it("an error mid-typing keeps the last good result, only adds a quiet hint", () => {
    const good = afterEval(NO_FILTER, ok());
    const typing = afterEval(good, err("unexpected EOF"));
    expect(typing).toEqual({ result: ok(), error: "unexpected EOF", active: true });
    expect(filterDisplay(typing).mode).toBe("result");
    // ...and fixing it brings the new result back, error gone.
    expect(afterEval(typing, ok({ count: 3 }))).toEqual({ result: ok({ count: 3 }), active: true });
    // With no good result yet, an error shows the full body.
    expect(filterDisplay(afterEval(NO_FILTER, err("x"))).mode).toBe("full");
  });
  it("what the viewer shows", () => {
    expect(filterDisplay(NO_FILTER)).toEqual({ mode: "full" });
    expect(filterDisplay({ result: ok(), active: false })).toEqual({ mode: "full" }); // ✕: full body, instantly
    expect(filterDisplay({ result: ok(), active: true })).toEqual({ mode: "result", text: "[\n  1\n]", structured: true, note: ok().matched_note });
    expect(filterDisplay({ result: ok({ result_is_text: true }), active: true })).toMatchObject({ structured: false });
    expect(filterDisplay({ result: ok({ truncated: true }), active: true })).toMatchObject({ structured: false }); // capped: flat
    expect(filterDisplay({ result: ok({ count: 0, matched_note: "no matches", result_json: "" }), active: true }))
      .toEqual({ mode: "empty", note: "no matches" });
  });
});

describe("auto-apply and save", () => {
  it("auto-applies a saved filter to a JSON response only", () => {
    expect(shouldAutoApply(".data[]", json)).toBe(true);
    expect(shouldAutoApply("  ", json)).toBe(false);
    expect(shouldAutoApply(".data[]", { contentType: "text/html", formatted: false, body: "" })).toBe(false);
  });
  it("save offers Full body | Filtered result only while a result shows", () => {
    expect(saveChoices(NO_FILTER)).toBeNull();
    expect(saveChoices({ result: ok(), active: false })).toBeNull();
    expect(saveChoices({ result: ok(), active: true })?.map((c) => c.id)).toEqual(["full", "filtered"]);
    expect(saveChoices({ result: ok({ count: 0 }), active: true })).toBeNull();
  });
  it("six help examples", () => expect(FILTER_EXAMPLES).toHaveLength(6));
  it("links the official jq docs (https, opened in the browser)", () => {
    expect(FILTER_DOCS.map((d) => d.label)).toEqual(["jq manual", "jq tutorial"]);
    for (const d of FILTER_DOCS) expect(d.url).toMatch(/^https:\/\/jqlang\.org\//);
  });
});

describe("debounced runner", () => {
  it("evaluates once, FILTER_DEBOUNCE_MS after the last keystroke", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async (q: string) => q.toUpperCase());
    const applied: string[] = [];
    const r = createFilterRunner(run, (_q, res) => applied.push(res));
    r.schedule(".d");
    vi.advanceTimersByTime(100);
    r.schedule(".da");
    vi.advanceTimersByTime(FILTER_DEBOUNCE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(1);
    expect(applied).toEqual([".DA"]);
    vi.useRealTimers();
  });
  it("drops answers to superseded queries", async () => {
    let release!: (v: string) => void;
    const run = vi.fn((q: string) => (q === "slow" ? new Promise<string>((res) => (release = res)) : Promise.resolve(q)));
    const applied: string[] = [];
    const r = createFilterRunner(run, (_q, res) => applied.push(res));
    const slow = r.now("slow");
    await r.now("fast");
    release("slow");
    await slow;
    expect(applied).toEqual(["fast"]);
  });
  it("cancel drops a pending evaluation", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async (q: string) => q);
    const r = createFilterRunner(run, () => undefined);
    r.schedule(".x");
    r.cancel();
    await vi.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
