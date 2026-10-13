// The response pane's Console tab (and the history detail's Console section):
// a send's script output, captured by Go (internal/scripting). This only shapes
// it for display: the badge, and the entries grouped per script in run order.
import type { scripting } from "../wailsjs/go/models";

export interface ConsoleBadge {
  count: number;
  error: boolean; // red when any entry is an error
}

export function consoleBadge(c: scripting.Console | undefined | null): ConsoleBadge {
  const entries = c?.entries ?? [];
  return { count: entries.length, error: entries.some((e) => e.level === "error") };
}

export interface ConsoleGroup {
  owner: string; // "folder 'api v2'", "request 'Login'"
  phase: string; // pre | post
  label: string; // "Pre-request · folder 'api v2'"
  entries: scripting.Entry[];
}

// Consecutive entries of the same script form one group (scripts run one after
// another, so this is per script, in run order).
export function consoleGroups(c: scripting.Console | undefined | null): ConsoleGroup[] {
  const out: ConsoleGroup[] = [];
  for (const e of c?.entries ?? []) {
    const last = out[out.length - 1];
    if (last && last.owner === e.owner && last.phase === e.phase) {
      last.entries.push(e);
      continue;
    }
    out.push({ owner: e.owner, phase: e.phase, label: `${e.phase === "pre" ? "Pre-request" : "Post-response"} · ${e.owner}`, entries: [e] });
  }
  return out;
}

// The Console tab's tooltip when it is disabled.
export const CONSOLE_EMPTY = "No script output for this send — console.log in a pre- or post-script appears here";
