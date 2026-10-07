import { describe, expect, it } from "vitest";
import { formatMs, HopLike, timingModel, triggerLabel } from "./timingModel";

const hop = (over: Partial<HopLike>): HopLike => ({
  url: "https://x.io/a", method: "GET", status: 200, dns_ms: 12.4, connect_ms: 30.1, wait_ms: 80.25, download_ms: 2,
  total_ms: 126, connection_reused: false, remote_addr: "1.2.3.4:443", ...over,
});

describe("timing panel model", () => {
  it("a single hop is one clean section: no numbering, a plain total footer", () => {
    const m = timingModel([hop({})])!;
    expect(m.single).toBe(true);
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0].badge).toBe("");
    expect(m.footer).toBe("Total 126 ms");
    expect(m.sections[0].rows.map((r) => [r.phase, r.value, r.kind])).toEqual([
      ["dns", "12.4 ms", "time"], ["connect", "30.1 ms", "time"], ["wait", "80.3 ms", "time"], ["download", "2.0 ms", "time"],
    ]);
    const seg = m.sections[0].segments;
    expect(seg.map((s) => s.phase)).toEqual(["dns", "connect", "wait", "download"]);
    expect(seg.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100, 6);
  });
  it("a redirect chain: one numbered section per hop and a hop-count footer", () => {
    const m = timingModel([
      hop({ status: 301, url: "https://old.example/path", total_ms: 142 }),
      hop({ status: 302, dns_ms: null, connect_ms: null, connection_reused: true, total_ms: 60 }),
      hop({ status: 200, dns_ms: null, connect_ms: null, connection_reused: true, total_ms: 310 }),
    ])!;
    expect(m.sections.map((s) => `${s.badge} ${s.status} ${s.total}`)).toEqual(["① 301 142 ms", "② 302 60.0 ms", "③ 200 310 ms"]);
    expect(m.footer).toBe("3 hops · 512 ms");
  });
  it("reused connection: dns/connect read 'reused' (not 0 ms) and are left out of the bar", () => {
    const s = timingModel([hop({}), hop({ dns_ms: null, connect_ms: null, connection_reused: true })])!.sections[1];
    expect(s.rows.slice(0, 2).map((r) => [r.value, r.kind])).toEqual([["reused", "reused"], ["reused", "reused"]]);
    expect(s.segments.map((x) => x.phase)).toEqual(["wait", "download"]);
  });
  it("a phase that did not happen on a fresh connection is '—' (e.g. no DNS for an IP literal), never 0", () => {
    const s = timingModel([hop({ dns_ms: null })])!.sections[0];
    expect(s.rows[0]).toMatchObject({ value: "—", kind: "none" });
    expect(timingModel([hop({ dns_ms: 0 })])!.sections[0].rows[0].value).toBe("0.0 ms"); // a real 0 stays visible
  });
  it("a failed hop marks its phase red with the error", () => {
    const dns = timingModel([hop({ status: 0, dns_ms: null, connect_ms: null, wait_ms: null, download_ms: null, failed_phase: "dns", error: 'could not resolve host "nope.invalid"' })])!;
    const s = dns.sections[0];
    expect(s.failed).toBe(true);
    expect(s.status).toBe("failed");
    expect(s.failure).toBe('failed during DNS lookup — could not resolve host "nope.invalid"');
    expect(s.rows[0]).toMatchObject({ kind: "failed", value: "failed" });
    const conn = timingModel([hop({ status: 0, dns_ms: null, connect_ms: 1.5, wait_ms: null, download_ms: null, failed_phase: "connect", error: "connection refused" })])!.sections[0];
    expect(conn.failure).toBe("failed during connect — connection refused");
    expect(conn.rows[1]).toMatchObject({ kind: "failed", value: "1.5 ms · failed" });
  });
  it("no hops: no panel; the trigger shows the response total, or a failed send's time", () => {
    expect(timingModel([])).toBeNull();
    expect(triggerLabel([], 42)).toBe("42 ms");
    expect(triggerLabel([hop({ total_ms: 10.4 }), hop({ total_ms: 20.3 })], undefined)).toBe("31 ms");
    expect(triggerLabel([], undefined)).toBe("");
    expect(formatMs(1234.6)).toBe("1235 ms");
    expect(formatMs(3.14)).toBe("3.1 ms");
  });
});
