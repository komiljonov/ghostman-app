// The "Use the Auth tab" hint on a hand-typed Authorization header (request
// editor, Headers). Pure rules, unit-tested; the UI is AuthHint.tsx.
// Shown on a row when ALL hold:
//   - the row is enabled and its key is Authorization (any casing);
//   - the request's OWN auth type is inherit or none;
//   - the auth it resolves to does not add an Authorization header itself (a
//     folder's bearer, …): then the user-written header deliberately wins and the
//     hint would only nag;
//   - it was not dismissed for this request (local, Go settings).
// Never automatic: the menu converts on request — Bearer (value "Bearer <token>")
// or an API key header — and DISABLES the original row (not deleted: the undo);
// the change is an ordinary draft edit, so the autosave PATCHes auth + headers.
import type { AuthConfig } from "./auth";
import type { Row } from "./rows";

export const isAuthorizationKey = (key: string) => key.trim().toLowerCase() === "authorization";

// Whether an (effective) auth config adds an Authorization header at send time
// (engine.ApplyAuth): bearer and basic always; an API key or a JWT when added to a
// header of that name (the JWT's default name is Authorization).
export function managesAuthorization(c: AuthConfig | null): boolean {
  if (!c) return false;
  switch (c.type) {
    case "bearer":
    case "basic":
      return true;
    case "api_key":
      return c.api_key_in === "header" && isAuthorizationKey(c.api_key_name);
    case "jwt":
      return c.jwt_add_to === "header" && isAuthorizationKey(c.jwt_name || "Authorization");
    default:
      return false;
  }
}

export function showAuthHint(row: Row, own: AuthConfig, resolved: AuthConfig | null, dismissed: boolean): boolean {
  return !dismissed && row.enabled && isAuthorizationKey(row.key)
    && (own.type === "inherit" || own.type === "none") && !managesAuthorization(resolved);
}

// The token of a "Bearer <token>" value (prefix in any casing), else undefined.
export function bearerTokenOf(value: string): string | undefined {
  const m = /^\s*bearer\s+(\S.*?)\s*$/i.exec(value);
  return m ? m[1] : undefined;
}

export interface AuthAndHeaders {
  auth: AuthConfig;
  headers: Row[];
}

const disableRow = (headers: Row[], index: number) => headers.map((h, i) => (i === index ? { ...h, enabled: false } : h));

// Bearer from the row's value; null when the value is not "Bearer <token>".
export function convertToBearer(auth: AuthConfig, headers: Row[], index: number): AuthAndHeaders | null {
  const token = headers[index] ? bearerTokenOf(headers[index].value) : undefined;
  if (token === undefined) return null;
  return { auth: { ...auth, type: "bearer", bearer_token: token }, headers: disableRow(headers, index) };
}

// An API key sent as this very header (its key and value as typed).
export function convertToApiKey(auth: AuthConfig, headers: Row[], index: number): AuthAndHeaders | null {
  const row = headers[index];
  if (!row) return null;
  return {
    auth: { ...auth, type: "api_key", api_key_name: row.key.trim(), api_key_value: row.value, api_key_in: "header" },
    headers: disableRow(headers, index),
  };
}
