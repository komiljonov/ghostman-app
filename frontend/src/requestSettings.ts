// Per-request client settings kept only on this machine (Go: request_settings in
// SQLite). Today just "follow redirects" (default on). The value loads with the
// tab; a toggle shows at once and is saved immediately — reverted if saving fails.
import type { session } from "../wailsjs/go/models";

export interface FollowDeps {
  get: (requestId: string) => Promise<boolean>;
  set: (requestId: string, follow: boolean) => Promise<{ error?: session.Problem }>;
  show: (follow: boolean) => void; // reflect in the tab state
}

export async function loadFollowRedirects(requestId: string, deps: Pick<FollowDeps, "get" | "show">): Promise<void> {
  let follow = true;
  try {
    follow = await deps.get(requestId);
  } catch {
    // keep the default
  }
  deps.show(follow);
}

// Returns the problem to show, or undefined when saved.
export async function toggleFollowRedirects(requestId: string, next: boolean, deps: FollowDeps): Promise<session.Problem | undefined> {
  deps.show(next);
  const result = await deps.set(requestId, next);
  if (result.error) deps.show(!next);
  return result.error;
}
