// JWT auth mode: labels, placeholders and the "Preview token" view. Signing,
// {{var}} resolution and the {{$now}} claims are Go (internal/engine/jwt.go,
// bound PreviewJWT); this file only shapes what the Auth editor shows.
// Pure — unit-tested in jwtAuth.test.ts.
import type { AuthConfig } from "./auth";
import { EnvDisplay, findTokens, MASK, VarInfo } from "./vars";

export const JWT_DEFAULT_HEADER = "Authorization";
export const JWT_DEFAULT_QUERY = "token";
export const JWT_DEFAULT_PREFIX = "Bearer ";

export const jwtNamePlaceholder = (addTo: string) => (addTo === "query" ? JWT_DEFAULT_QUERY : JWT_DEFAULT_HEADER);

// The prefix applies to a header only; for the query it is kept but disabled.
export const jwtPrefixDisabled = (addTo: string) => addTo === "query";

// "Sent as Authorization: Bearer <token>" / "Sent as ?token=<token>".
export function jwtSentAs(a: Pick<AuthConfig, "jwt_add_to" | "jwt_name" | "jwt_prefix">): string {
  const name = a.jwt_name.trim();
  if (a.jwt_add_to === "query") return `?${name || JWT_DEFAULT_QUERY}=<token>`;
  return `${name || JWT_DEFAULT_HEADER}: ${a.jwt_prefix || JWT_DEFAULT_PREFIX}<token>`;
}

export const JWT_SECRET_HINT = "Use a {{secret_variable}} — its value stays on this computer (see Environments). Text typed here is saved on the server for everyone on the project.";

// The help popover: the dynamic time claims (DynamicClaim in Go is the spec).
export const JWT_CLAIM_HELP: { token: string; meaning: string }[] = [
  { token: "\"{{$now}}\"", meaning: "the current time in unix seconds, e.g. \"iat\": \"{{$now}}\"" },
  { token: "\"{{$now+N}}\"", meaning: "N seconds from now, e.g. \"exp\": \"{{$now+3600}}\" (one hour)" },
  { token: "\"{{$now-N}}\"", meaning: "N seconds ago, e.g. \"nbf\": \"{{$now-30}}\"" },
];
export const JWT_CLAIM_RULES = [
  "Only a string value that is EXACTLY one of these becomes a number when the token is signed — \"at {{$now}}\" or a key stays as written.",
  "Other {{variables}} resolve from the active environment, as everywhere else; one without a value stays literal (and is reported).",
  "A secret {{variable}} without a value on this machine stops the send: the token is never signed with a placeholder.",
  "The token is signed fresh for every send.",
];

// The secret as the preview names it: {{vars}} visible, literal text masked —
// never the resolved value (that one never leaves Go).
export function maskedSecret(secret: string, base64: boolean): string {
  if (secret === "") return "(empty)";
  let out = "";
  let last = 0;
  for (const t of findTokens(secret)) {
    if (t.from > last) out += MASK;
    out += secret.slice(t.from, t.to);
    last = t.to;
  }
  if (last < secret.length) out += MASK;
  return base64 ? `${out} (Base64)` : out;
}

export interface JWTPreviewData {
  header: string;
  payload: string;
  token_head: string;
  token_tail: string;
  unresolved: string[];
  environment: string;
}

export type PreviewView =
  | { kind: "error"; message: string }
  | { kind: "ok"; header: string; payload: string; token: string; secret: string; notes: string[] };

export function previewView(
  res: { data?: JWTPreviewData; error?: { message: string } },
  a: Pick<AuthConfig, "jwt_secret" | "jwt_secret_base64">,
): PreviewView {
  if (res.error || !res.data) return { kind: "error", message: res.error?.message ?? "could not build the token" };
  const d = res.data;
  const notes: string[] = [];
  if (!d.environment) notes.push("No active environment — {{variables}} stay literal.");
  const missing = (d.unresolved ?? []).map((k) => `{{${k}}}`);
  if (missing.length > 0) notes.push(`${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no value${d.environment ? ` in ${d.environment}` : ""} — signed as literal text.`);
  return {
    kind: "ok",
    header: d.header,
    payload: d.payload,
    token: `${d.token_head}…${d.token_tail}`,
    secret: maskedSecret(a.jwt_secret, a.jwt_secret_base64),
    notes,
  };
}

// {{$now}} / {{$now+N}} / {{$now-N}} — the same exact form as engine.DynamicClaim.
const TIME_CLAIM = /^\$now(?:([+-])(\d+))?$/;

export function timeClaimText(key: string): string | undefined {
  const m = TIME_CLAIM.exec(key);
  if (!m) return undefined;
  const n = m[1] ? `${m[1] === "+" ? "+" : "−"} ${m[2]} s` : "";
  return `unix time now${n ? " " + n : ""} — a number in the signed token (as a string value only)`;
}

// The env the PAYLOAD editor highlights with: the active environment plus every
// {{$now…}} key as a resolved, non-editable "time claim" (hover explains it). Only
// that editor gets it — anywhere else {{$now}} is not special and stays unresolved.
export function withTimeClaims(env: EnvDisplay): EnvDisplay {
  const vars = new Map(env.vars);
  const base = vars.get.bind(vars);
  vars.get = (key: string): VarInfo | undefined => {
    const text = timeClaimText(key);
    return text ? { key, value: text, secret: false, hasValue: true, dynamic: true } : base(key);
  };
  return { ...env, vars };
}
