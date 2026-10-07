// Redirect settings, kept only on this machine (Go: SQLite). A global default
// (Settings modal) and a per-request mode (the request's Settings sub-tab):
// "default" (use the global value), "always" or "never". Go resolves the
// effective value at send time; these helpers only wire the UI. Values load
// with the tab; a change shows at once and is saved immediately — reverted if
// saving fails.
import type { session } from "../wailsjs/go/models";

export type RedirectMode = "default" | "always" | "never";

export const REDIRECT_MODES: RedirectMode[] = ["default", "always", "never"];

export const asRedirectMode = (v: string | undefined): RedirectMode =>
  v === "always" || v === "never" ? v : "default";

// What a send will do for this mode, given the global default.
export const effectiveFollow = (mode: RedirectMode, globalDefault: boolean) =>
  mode === "default" ? globalDefault : mode === "always";

export function modeLabel(mode: RedirectMode, globalDefault: boolean): string {
  if (mode === "default") return `Use default (${globalDefault ? "on" : "off"})`;
  return mode === "always" ? "Always follow" : "Never follow";
}

export interface ModeDeps {
  set: (requestId: string, mode: RedirectMode) => Promise<{ error?: session.Problem }>;
  show: (mode: RedirectMode) => void; // reflect in the tab state
}

export async function loadRedirectMode(
  requestId: string,
  deps: { get: (requestId: string) => Promise<{ mode: string }>; show: (mode: RedirectMode) => void },
): Promise<void> {
  let mode: RedirectMode = "default";
  try {
    mode = asRedirectMode((await deps.get(requestId)).mode);
  } catch {
    // keep the default
  }
  deps.show(mode);
}

// Returns the problem to show, or undefined when saved.
export async function changeRedirectMode(requestId: string, from: RedirectMode, to: RedirectMode, deps: ModeDeps): Promise<session.Problem | undefined> {
  if (from === to) return undefined;
  deps.show(to);
  const result = await deps.set(requestId, to);
  if (result.error) deps.show(from);
  return result.error;
}

// The global default: same optimistic save + revert.
export async function changeRedirectDefault(
  from: boolean, to: boolean,
  deps: { set: (follow: boolean) => Promise<{ error?: session.Problem }>; show: (follow: boolean) => void },
): Promise<session.Problem | undefined> {
  if (from === to) return undefined;
  deps.show(to);
  const result = await deps.set(to);
  if (result.error) deps.show(from);
  return result.error;
}
