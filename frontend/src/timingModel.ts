// The timing panel's model: one section per hop (initial request + each followed
// redirect) with a stacked bar and a phase table. Pure, so unit-testable;
// TimingPanel.tsx renders it. Phase numbers come from Go (internal/engine/trace.go);
// a phase that did not happen is null there — shown as "reused" when the
// connection was reused, "—" otherwise — never as 0 ms.

export type Phase = "dns" | "connect" | "wait" | "download";

export interface HopLike {
  url: string;
  method: string;
  status: number;
  status_text?: string;
  dns_ms?: number | null;
  connect_ms?: number | null;
  wait_ms?: number | null;
  download_ms?: number | null;
  total_ms: number;
  connection_reused: boolean;
  remote_addr?: string;
  failed_phase?: string;
  error?: string;
}

export const PHASES: { id: Phase; label: string }[] = [
  { id: "dns", label: "DNS lookup" },
  { id: "connect", label: "Connect" },
  { id: "wait", label: "Waiting (TTFB)" },
  { id: "download", label: "Download" },
];

const FAILED_LABEL: Record<Phase, string> = {
  dns: "failed during DNS lookup",
  connect: "failed during connect",
  wait: "failed while waiting for the response",
  download: "failed during download",
};

export interface Segment {
  phase: Phase;
  ms: number;
  pct: number; // width in the hop's bar, 0-100
}

export interface PhaseRow {
  phase: Phase;
  label: string;
  value: string; // "12.3 ms" | "reused" | "—"
  kind: "time" | "reused" | "none" | "failed";
}

export interface HopSection {
  badge: string; // "①" … (empty for a single hop: no list look)
  status: string; // "301", "200", "failed"
  method: string;
  url: string;
  total: string;
  failed: boolean;
  failure?: string; // "failed during DNS lookup — could not resolve host ..."
  segments: Segment[];
  rows: PhaseRow[];
  remote?: string;
}

export interface TimingModel {
  sections: HopSection[];
  footer: string; // "4 hops · 512 ms" (multi) or "Total 42 ms" (single)
  single: boolean;
}

export const formatMs = (v: number) => (v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`);

const circled = (i: number) => (i < 20 ? String.fromCodePoint(0x2460 + i) : `(${i + 1})`);

const phaseValue = (h: HopLike, p: Phase): number | null => {
  const v = h[`${p}_ms` as const];
  return typeof v === "number" ? v : null;
};

function section(h: HopLike, index: number, single: boolean): HopSection {
  const failedPhase = PHASES.find((p) => p.id === h.failed_phase)?.id;
  const measured = PHASES.map((p) => ({ phase: p.id, ms: phaseValue(h, p.id) }))
    .filter((s): s is { phase: Phase; ms: number } => s.ms !== null);
  const sum = measured.reduce((a, s) => a + s.ms, 0);
  const segments = sum > 0 ? measured.map((s) => ({ ...s, pct: (s.ms / sum) * 100 })) : [];
  const rows: PhaseRow[] = PHASES.map((p) => {
    const v = phaseValue(h, p.id);
    if (p.id === failedPhase) return { phase: p.id, label: p.label, value: v === null ? "failed" : `${formatMs(v)} · failed`, kind: "failed" };
    if (v !== null) return { phase: p.id, label: p.label, value: formatMs(v), kind: "time" };
    const reused = h.connection_reused && (p.id === "dns" || p.id === "connect");
    return { phase: p.id, label: p.label, value: reused ? "reused" : "—", kind: reused ? "reused" : "none" };
  });
  return {
    badge: single ? "" : circled(index),
    status: failedPhase ? "failed" : String(h.status),
    method: h.method,
    url: h.url,
    total: formatMs(h.total_ms),
    failed: !!failedPhase,
    failure: failedPhase ? `${FAILED_LABEL[failedPhase]}${h.error ? ` — ${h.error}` : ""}` : undefined,
    segments,
    rows,
    remote: h.remote_addr || undefined,
  };
}

export function timingModel(hops: HopLike[]): TimingModel | null {
  if (hops.length === 0) return null;
  const single = hops.length === 1;
  const total = hops.reduce((a, h) => a + h.total_ms, 0);
  return {
    sections: hops.map((h, i) => section(h, i, single)),
    footer: single ? `Total ${formatMs(total)}` : `${hops.length} hops · ${formatMs(total)}`,
    single,
  };
}

// The duration shown in the toolbar (and the panel's trigger): the response's
// total, or after a failed send the time its hops took.
export function triggerLabel(hops: HopLike[], durationMs: number | undefined): string {
  if (durationMs !== undefined) return `${durationMs} ms`;
  if (hops.length === 0) return "";
  return `${Math.round(hops.reduce((a, h) => a + h.total_ms, 0))} ms`;
}
