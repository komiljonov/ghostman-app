// {{var}} display logic for highlighting and hover. Resolution itself happens in Go
// at send time (internal/engine/resolve.go is the single source of truth); this
// mirrors its token grammar so what is highlighted is exactly what will be replaced:
//   a token is "{{" + key + "}}", key = 1+ chars without "{" or "}", matched exactly
//   (case-sensitive, no trimming), left to right, non-overlapping.
// Keep vars.test.ts in step with internal/engine/resolve_test.go.

export interface VarInfo {
  id?: string; // the variable's id (needed to edit it from a tooltip)
  key: string;
  value: string;
  secret: boolean;
  hasValue: boolean; // secrets: whether this machine has a value
}

// What the highlighter knows about the active environment. envName === null means
// "No environment".
export interface EnvDisplay {
  envId?: string;
  envName: string | null;
  vars: Map<string, VarInfo>;
  // Every environment's variable KEYS (no values), for {{var}} completion.
  keys?: { key: string; envs: string[]; secret: boolean }[];
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

// ---- Plain rendering (table cells before their editor is mounted) ----

export interface Segment {
  text: string;
  kind: "plain" | "resolved" | "unresolved";
}

// Splits text into plain runs and {{tokens}} classified like the editor does.
export function segments(text: string, env: EnvDisplay): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const t of classify(text, env)) {
    if (t.from > last) out.push({ text: text.slice(last, t.from), kind: "plain" });
    out.push({ text: text.slice(t.from, t.to), kind: t.resolved ? "resolved" : "unresolved" });
    last = t.to;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
  return out;
}

// ---- Editing from the hover tooltip ----

export interface TooltipActions {
  edit: boolean; // the value can be edited inline right away
  editAfterReveal: boolean; // secret with a value: edit is offered once it is revealed
  createIn?: string; // unresolved with an active env: "Create in <env>"
}

export function tooltipActions(key: string, env: EnvDisplay): TooltipActions {
  const v = env.vars.get(key);
  if (env.envName === null || !env.envId) return { edit: false, editAfterReveal: false };
  if (!v) return { edit: false, editAfterReveal: false, createIn: env.envName };
  if (v.secret) return { edit: !v.hasValue, editAfterReveal: v.hasValue }; // an unset secret can be set directly
  return { edit: true, editAfterReveal: false };
}

// The bound calls a tooltip edit goes through — the same ones the env tab uses.
export interface VarEditApi {
  setValue: (envId: string, varId: string, value: string) => Promise<{ error?: { message: string } }>;
  create: (envId: string, key: string, type: string) => Promise<{ data?: { id: string } | null; error?: { message: string } }>;
  refresh: () => Promise<unknown>;
}

// Saves a value typed into the tooltip. Go routes it: server for regular
// variables, this machine only for secrets. Returns an error message or undefined.
export async function saveFromTooltip(key: string, value: string, env: EnvDisplay, impl: VarEditApi): Promise<string | undefined> {
  const v = env.vars.get(key);
  if (!env.envId || !v?.id) return "variable not found";
  const res = await impl.setValue(env.envId, v.id, value);
  if (res.error) return res.error.message;
  await impl.refresh();
  return undefined;
}

// "Create in <env>": a regular variable with no value yet; returns its id.
export async function createFromTooltip(key: string, env: EnvDisplay, impl: VarEditApi): Promise<{ id?: string; error?: string }> {
  if (!env.envId) return { error: "no environment selected" };
  const res = await impl.create(env.envId, key, "regular");
  if (res.error || !res.data) return { error: res.error?.message ?? "could not create the variable" };
  await impl.refresh();
  return { id: res.data.id };
}

// A masked (password) field hides literal text but keeps {{var}} tokens visible
// (a token is a name, not a secret). The ranges of literal text, in order.
export function maskRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  let pos = 0;
  for (const t of findTokens(text)) {
    if (t.from > pos) out.push([pos, t.from]);
    pos = t.to;
  }
  if (pos < text.length) out.push([pos, text.length]);
  return out;
}
