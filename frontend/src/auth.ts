// Authorization (Auth sub-tab and the folder Settings modal): the stored shape,
// the mode list and the labels. Resolution is settingsResolver.resolveAuth; the
// header / query param is built in Go at send time (internal/engine/auth.go).
// Pure — unit-tested in auth.test.ts.
import { ResolvedAuth, resolveAuthInTree, resolveAuthParent, sourceLabel } from "./settingsResolver";
import type { Tree } from "./tree";

export type AuthType = "inherit" | "none" | "bearer" | "basic" | "api_key";
export type ApiKeyIn = "header" | "query";

// The server's shape. Fields that do not match `type` are KEPT (server and UI):
// switching mode back restores what was typed.
export interface AuthConfig {
  type: AuthType;
  bearer_token: string;
  basic_username: string;
  basic_password: string;
  api_key_name: string;
  api_key_value: string;
  api_key_in: ApiKeyIn;
}

// Loose input (server JSON / generated models use plain strings).
export type AuthInput = { [K in keyof AuthConfig]?: string };

export const AUTH_TYPES: AuthType[] = ["inherit", "none", "bearer", "basic", "api_key"];

const asType = (v: unknown): AuthType => (AUTH_TYPES.includes(v as AuthType) ? (v as AuthType) : "inherit");

export function normalizeAuth(a?: AuthInput | null): AuthConfig {
  return {
    type: asType(a?.type),
    bearer_token: a?.bearer_token ?? "",
    basic_username: a?.basic_username ?? "",
    basic_password: a?.basic_password ?? "",
    api_key_name: a?.api_key_name ?? "",
    api_key_value: a?.api_key_value ?? "",
    api_key_in: a?.api_key_in === "query" ? "query" : "header",
  };
}

export const TYPE_LABEL: Record<AuthType, string> = {
  inherit: "Inherit from parent",
  none: "No auth",
  bearer: "Bearer token",
  basic: "Basic auth",
  api_key: "API key",
};

// Short name of an effective config: "Bearer", "Basic", "API key (query)", "No auth".
export function effectiveName(config: AuthConfig | null): string {
  if (!config) return "No auth";
  switch (config.type) {
    case "bearer":
      return "Bearer";
    case "basic":
      return "Basic";
    case "api_key":
      return config.api_key_in === "query" ? "API key (query)" : "API key (header)";
    default:
      return "No auth";
  }
}

// "Bearer (from folder ‘api v2’)" / "No auth (nothing set in parents)".
export const resolvedLabel = (r: ResolvedAuth) => `${effectiveName(r.config)} (${sourceLabel(r.source)})`;

// The mode options; "Inherit" names what it would resolve to right now.
export function modeOptions(tree: Tree, id: string): { value: AuthType; label: string }[] {
  const parent = resolveAuthParent(tree, id) ?? { config: null, source: { kind: "default" as const } };
  return AUTH_TYPES.map((t) => ({
    value: t,
    label: t === "inherit" ? `Inherit from parent — ${resolvedLabel(parent)}` : TYPE_LABEL[t],
  }));
}

// Switching mode changes only the type; every other field stays as typed.
export const withType = (a: AuthConfig, type: AuthType): AuthConfig => ({ ...a, type });

// The effective auth of a request tab: its draft (unsaved edits included), then
// its folders from the tree store. A request not (yet) in the tree resolves on
// its own config alone.
export function effectiveAuthOf(tree: Tree, requestId: string, draft: AuthConfig): ResolvedAuth {
  return resolveAuthInTree(tree, requestId, draft)
    ?? (draft.type === "bearer" || draft.type === "basic" || draft.type === "api_key"
      ? { config: draft, source: { kind: "node", id: requestId, nodeKind: "request", name: "" } }
      : { config: null, source: draft.type === "none" ? { kind: "node", id: requestId, nodeKind: "request", name: "" } : { kind: "default" } });
}

// The Settings/Auth sub-tab dot: the request sets something itself.
export function overridesSomething(s: { authType: AuthType; follow: string }): { auth: boolean; settings: boolean } {
  return { auth: s.authType !== "inherit", settings: s.follow !== "inherit" };
}

export const AUTH_HINT = "Tip: use a secret variable, e.g. {{API_TOKEN}} — its value stays on this computer. Text typed here is saved on the server for everyone on the project.";

// The fields of a config that its type uses, for read-only display (history).
export function authRows(a: AuthConfig): { key: string; value: string }[] {
  switch (a.type) {
    case "bearer":
      return [{ key: "Token", value: a.bearer_token }];
    case "basic":
      return [{ key: "Username", value: a.basic_username }, { key: "Password", value: a.basic_password }];
    case "api_key":
      return [{ key: "Key", value: a.api_key_name }, { key: "Value", value: a.api_key_value }, { key: "Add to", value: a.api_key_in === "query" ? "Query params" : "Header" }];
    default:
      return [];
  }
}
