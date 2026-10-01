// {{var}} display logic for highlighting and hover. Resolution itself happens in Go
// at send time (internal/engine/resolve.go is the single source of truth); this
// mirrors its token grammar so what is highlighted is exactly what will be replaced:
//   a token is "{{" + key + "}}", key = 1+ chars without "{" or "}", matched exactly
//   (case-sensitive, no trimming), left to right, non-overlapping.
// Keep vars.test.ts in step with internal/engine/resolve_test.go.

export interface VarInfo {
  key: string;
  value: string;
  secret: boolean;
  hasValue: boolean; // secrets: whether this machine has a value
}

// What the highlighter knows about the active environment. envName === null means
// "No environment".
export interface EnvDisplay {
  envName: string | null;
  vars: Map<string, VarInfo>;
}

export interface VarToken {
  key: string;
  from: number; // offsets of the whole {{key}} token (to exclusive)
  to: number;
}

export function findTokens(text: string): VarToken[] {
  const out: VarToken[] = [];
  let i = 0;
  for (;;) {
    const start = text.indexOf("{{", i);
    if (start < 0) return out;
    const keyStart = start + 2;
    let k = keyStart;
    while (k < text.length && text[k] !== "{" && text[k] !== "}") k++;
    if (k > keyStart && text.startsWith("}}", k)) {
      out.push({ key: text.slice(keyStart, k), from: start, to: k + 2 });
      i = k + 2;
    } else {
      i = start + 1;
    }
  }
}

// Resolved = Go would replace it: the key is defined, and a secret has a local value.
export function isResolved(key: string, env: EnvDisplay): boolean {
  const v = env.vars.get(key);
  return !!v && (!v.secret || v.hasValue);
}

export function classify(text: string, env: EnvDisplay): (VarToken & { resolved: boolean })[] {
  return findTokens(text).map((t) => ({ ...t, resolved: isResolved(t.key, env) }));
}

export const MASK = "••••••";

export interface TooltipModel {
  key: string;
  resolved: boolean;
  secret: boolean;
  // Text to show by default: the value, the mask for secrets, or an explanation.
  display: string;
  // The real value, only for click-to-reveal of a secret.
  revealValue?: string;
  envName: string | null;
  tag?: string; // "local" for secret values (they exist only on this machine)
}

export function tooltipModel(key: string, env: EnvDisplay): TooltipModel {
  const v = env.vars.get(key);
  if (env.envName === null) {
    return { key, resolved: false, secret: false, display: "unresolved — no environment selected", envName: null };
  }
  if (!v) {
    return { key, resolved: false, secret: false, display: `unresolved — not defined in ${env.envName}`, envName: env.envName };
  }
  if (v.secret) {
    if (!v.hasValue) {
      return { key, resolved: false, secret: true, display: "not set on this machine", envName: env.envName, tag: "local" };
    }
    return { key, resolved: true, secret: true, display: MASK, revealValue: v.value, envName: env.envName, tag: "local" };
  }
  return { key, resolved: true, secret: false, display: v.value === "" ? "(empty)" : v.value, envName: env.envName };
}

export const NO_ENV: EnvDisplay = { envName: null, vars: new Map() };
