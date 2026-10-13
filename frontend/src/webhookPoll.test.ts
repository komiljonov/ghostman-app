import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPage, clearedFeed, createPoller, emptyFeed, failPoll, Feed, MAX_FEED, PollAnswer } from "./webhookPoll";

type C = { id: number };
const caps = (...ids: number[]): C[] => ids.map((id) => ({ id }));
const ids = (f: Feed<C>) => f.captures.map((c) => c.id);

describe("applyPage: cursor, prepend, unseen and the new chip", () => {
  it("the first answer is the backlog: listed newest first, nothing unseen or fresh", () => {
    const f = applyPage(emptyFeed<C>(), caps(1, 2, 3), { visible: false, pinned: false });
    expect(ids(f)).toEqual([3, 2, 1]);
    expect(f).toMatchObject({ cursor: 3, loaded: true, unseen: 0, fresh: 0 });
  });
  it("later answers prepend and advance the cursor", () => {
    let f = applyPage(emptyFeed<C>(), caps(1, 2), { visible: true, pinned: true });
    f = applyPage(f, caps(3, 4), { visible: true, pinned: true });
    expect(ids(f)).toEqual([4, 3, 2, 1]);
    expect(f.cursor).toBe(4);
    expect(f.unseen).toBe(0);
    expect(f.fresh).toBe(0); // at the top: the rows just appear
  });
  it("an empty answer keeps the cursor; ids at or below it are ignored", () => {
    let f = applyPage(emptyFeed<C>(), caps(5), { visible: true, pinned: true });
    f = applyPage(f, [], { visible: true, pinned: true });
    f = applyPage(f, caps(4, 5), { visible: true, pinned: true });
    expect(ids(f)).toEqual([5]);
    expect(f.cursor).toBe(5);
  });
  it("counts unseen while the tab is not visible; visible clears it", () => {
    let f = applyPage(emptyFeed<C>(), [], { visible: false, pinned: true });
    f = applyPage(f, caps(1, 2), { visible: false, pinned: true });
    f = applyPage(f, caps(3), { visible: false, pinned: true });
    expect(f.unseen).toBe(3);
    expect(applyPage(f, [], { visible: true, pinned: true }).unseen).toBe(0);
  });
  it("counts fresh rows while scrolled away (the chip), pinned resets it", () => {
    let f = applyPage(emptyFeed<C>(), caps(1), { visible: true, pinned: true });
    f = applyPage(f, caps(2, 3), { visible: true, pinned: false });
    expect(f.fresh).toBe(2);
    f = applyPage(f, caps(4), { visible: true, pinned: false });
    expect(f.fresh).toBe(3);
    expect(applyPage(f, [], { visible: true, pinned: true }).fresh).toBe(0);
  });
  it("keeps the newest MAX_FEED rows", () => {
    const many = caps(...Array.from({ length: MAX_FEED + 20 }, (_, i) => i + 1));
    const f = applyPage(emptyFeed<C>(), many, { visible: true, pinned: true });
    expect(f.captures.length).toBe(MAX_FEED);
    expect(f.captures[0].id).toBe(MAX_FEED + 20);
  });
  it("an error is kept until the next good answer; clear all keeps the cursor", () => {
    let f = failPoll(applyPage(emptyFeed<C>(), caps(1, 2), { visible: true, pinned: true }), "server unreachable");
    expect(f.error).toBe("server unreachable");
    expect(ids(f)).toEqual([2, 1]);
    f = clearedFeed(applyPage(f, [], { visible: true, pinned: true }));
    expect(f.error).toBeUndefined();
    expect(ids(f)).toEqual([]);
    expect(f.cursor).toBe(2);
  });
});

describe("createPoller: interval, focus pause / resume, 404", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (answer: (id: string, after: number) => PollAnswer<C> = () => ({ data: [] }), focused = true) => {
    const calls: string[] = [];
    const cursors = new Map<string, number>();
    const events: string[] = [];
    const poller = createPoller<C>({
      intervalMs: 2000,
      poll: async (id, after) => {
        calls.push(`${id}@${after}`);
        return answer(id, after);
      },
      cursor: (id) => cursors.get(id) ?? 0,
      onPage: (id, page) => {
        if (page.length) cursors.set(id, page[page.length - 1].id);
        events.push(`page ${id} ${page.length}`);
      },
      onError: (id, m) => events.push(`error ${id} ${m}`),
      onGone: (id) => events.push(`gone ${id}`),
      focused: () => focused,
    });
    return { poller, calls, events };
  };

  it("polls a new tab at once, then every interval with the highest id", async () => {
    let next = 1;
    const { poller, calls } = setup(() => ({ data: [{ id: next++ }] }));
    poller.sync(["w1"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["w1@0"]);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual(["w1@0", "w1@1", "w1@2"]);
    poller.dispose();
  });

  it("stops polling a closed tab", async () => {
    const { poller, calls } = setup();
    poller.sync(["w1", "w2"]);
    await vi.advanceTimersByTimeAsync(0);
    poller.sync(["w2"]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls.filter((c) => c.startsWith("w1")).length).toBe(1);
    expect(calls.filter((c) => c.startsWith("w2")).length).toBe(4);
    poller.dispose();
  });

  it("pauses while the window is unfocused and catches up at once on focus", async () => {
    const { poller, calls } = setup();
    poller.sync(["w1"]);
    await vi.advanceTimersByTimeAsync(0);
    poller.setFocused(false);
    expect(poller.listening("w1")).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.length).toBe(1);
    poller.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(2); // immediately, not after the interval
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.length).toBe(3);
    poller.dispose();
  });

  it("a tab opened while unfocused polls when focus returns", async () => {
    const { poller, calls } = setup(undefined, false);
    poller.sync(["w1"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(0);
    poller.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["w1@0"]);
    poller.dispose();
  });

  it("errors retry silently; a 404 stops and reports the endpoint gone", async () => {
    let n = 0;
    const { poller, calls, events } = setup(() => {
      n++;
      if (n === 1) return { error: { message: "cannot reach the server" } };
      if (n === 2) return { data: [] };
      return { error: { status: 404, message: "webhook not found" } };
    });
    poller.sync(["w1"]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual(["error w1 cannot reach the server", "page w1 0", "gone w1"]);
    expect(calls.length).toBe(3);
    expect(poller.listening("w1")).toBe(false);
    poller.dispose();
  });

  it("never runs two polls of one endpoint at once", async () => {
    let release: (() => void) | undefined;
    const calls: number[] = [];
    const poller = createPoller<C>({
      intervalMs: 2000,
      poll: (_id, after) => {
        calls.push(after);
        return new Promise((r) => (release = () => r({ data: [] })));
      },
      cursor: () => 0, onPage: () => undefined, onError: () => undefined, onGone: () => undefined, focused: () => true,
    });
    poller.sync(["w1"]);
    poller.setFocused(false);
    poller.setFocused(true); // would poll again — but one is in flight
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);
    release!();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.length).toBe(2);
    poller.dispose();
  });
});
