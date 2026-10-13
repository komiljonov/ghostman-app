// Pure rules of the webhook capture UI (URLs, domain choice, the sidebar panel's
// size, the response status, capture rows). No Solid, no bindings — unit-tested
// in webhookModel.test.ts. The capture → request composition lives in Go
// (api.CaptureDraft).

// ---- URLs ----

// The two ways a sender reaches an endpoint. Always https: the capture host
// terminates TLS. The subdomain form needs wildcard DNS on the server.
export function hookUrls(slug: string, domain: string): { primary: string; subdomain: string } {
  return { primary: `https://${domain}/h/${slug}`, subdomain: `https://${slug}.${domain}/` };
}

// ---- Domain ----

export interface DomainChoice {
  domain: string; // what the URLs use ("" when the feature is off)
  missing: boolean; // the stored preference is no longer offered by the server
  off: boolean; // the server offers no domains (feature not configured)
}

// The domain an endpoint uses: its stored preference when the server still offers
// it, else the server's default (the first). "" stored = the default.
export function effectiveDomain(stored: string, offered: readonly string[]): DomainChoice {
  if (offered.length === 0) return { domain: "", missing: false, off: true };
  if (stored === "" || offered.includes(stored)) return { domain: stored || offered[0], missing: false, off: false };
  return { domain: offered[0], missing: true, off: false };
}

// ---- Errors ----

export const HOOKS_NOT_CONFIGURED = "hooks_not_configured";
export const NOT_CONFIGURED_TEXT =
  "Webhook capture is not set up on this server. Ask its administrator to configure HOOKS_DOMAINS.";

export const isNotConfigured = (p: { code?: string } | undefined | null) => p?.code === HOOKS_NOT_CONFIGURED;

// ---- Sidebar panel size ----

export const PANEL_MIN_PX = 120;
export const TREE_MIN_PX = 160;
export const PANEL_DEFAULT_FRACTION = 0.3;

// A panel height in px for a sidebar of `total` px, clamped so the panel keeps
// PANEL_MIN_PX and the tree TREE_MIN_PX (a sidebar too short for both keeps the
// panel's minimum; the tree scrolls). Dragging past either end stops there.
export function clampPanel(px: number, total: number): number {
  const max = Math.max(PANEL_MIN_PX, total - TREE_MIN_PX);
  return Math.min(Math.max(Math.round(px), PANEL_MIN_PX), max);
}

// The expanded panel's height for the stored fraction (invalid → 30 %).
export function panelHeight(fraction: number, total: number): number {
  return clampPanel((fraction > 0 && fraction < 1 ? fraction : PANEL_DEFAULT_FRACTION) * total, total);
}

// The fraction to store after a drag left the panel at `px` of `total`.
export function panelFraction(px: number, total: number): number {
  if (total <= 0) return PANEL_DEFAULT_FRACTION;
  return Math.min(Math.max(clampPanel(px, total) / total, 0.01), 0.99);
}

// ---- Response status ----

// The configured response status from the input: an integer 100–599, else a reason.
export function parseStatus(text: string): { ok: true; status: number } | { ok: false; error: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return { ok: false, error: "Status must be a number between 100 and 599" };
  const n = Number(t);
  if (n < 100 || n > 599) return { ok: false, error: "Status must be between 100 and 599" };
  return { ok: true, status: n };
}

// ---- Capture rows ----

export const capturePathLabel = (c: { path: string; query: string }) => (c.query ? `${c.path}?${c.query}` : c.path) || "/";

// "just now", "12s ago", "5m ago", "3h ago", "2d ago" (a capture list is recent by nature).
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// The configured response's Content-Type (the last enabled one), for the body
// editor's JSON highlighting.
export function responseContentType(rows: readonly { key: string; value: string; enabled: boolean }[]): string {
  let ct = "";
  for (const r of rows) if (r.enabled && r.key.trim().toLowerCase() === "content-type") ct = r.value;
  return ct;
}
