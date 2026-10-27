// The proxy setting's UI rules (pure; unit-tested in proxySettings.test.ts):
// the request Settings tab and the folder Settings… modal show the same row —
// Inherit (with what it resolves to) | Use global | No proxy | Use proxy… —
// with live labels over the tree store and the project's proxy list. Resolution
// itself is settingsResolver.resolveProxy.
import { resolveProxyInTree, resolveProxyParent, ResolvedProxy, Source, sourceLabel } from "./settingsResolver";
import type { NodeProxy, Tree } from "./tree";

export interface ProxyRef {
  id: string;
  name: string;
}

export type ProxyMode = "inherit" | "global" | "none" | "proxy";

// What a resolution reads as: "Corp proxy" or "direct".
export function proxyName(r: { proxyId: string | null }, proxies: ProxyRef[]): string {
  return r.proxyId ? proxies.find((p) => p.id === r.proxyId)?.name ?? "direct" : "direct";
}

const sourceText = (s: Source) => (s.kind === "global" ? "global default" : sourceLabel(s));

// "Corp proxy (from folder ‘api’)" / "direct (global default)".
export const describeProxy = (r: ResolvedProxy, proxies: ProxyRef[]) => `${proxyName(r, proxies)} (${sourceText(r.source)})`;

// The node's own value as the row shows it: a "proxy" pointing at a proxy that
// no longer exists IS inherit (that is how it resolves), flagged so the row can say so.
export function shownProxy(own: NodeProxy, proxies: ProxyRef[]): { mode: ProxyMode; proxyId: string | null; deleted: boolean } {
  const mode = (["inherit", "global", "none", "proxy"].includes(own.mode) ? own.mode : "inherit") as ProxyMode;
  if (mode === "proxy" && !(own.proxyId && proxies.some((p) => p.id === own.proxyId))) return { mode: "inherit", proxyId: null, deleted: true };
  return { mode, proxyId: mode === "proxy" ? own.proxyId : null, deleted: false };
}

export interface ProxyOption {
  mode: ProxyMode;
  label: string;
}

// The four choices with their live labels for a node.
export function proxyOptions(tree: Tree, id: string, globalDefault: string, proxies: ProxyRef[]): ProxyOption[] {
  const known = (pid: string) => proxies.some((p) => p.id === pid);
  const parent = resolveProxyParent(tree, id, globalDefault, known) ?? { proxyId: null, source: { kind: "global" as const } };
  const global = proxies.find((p) => p.id === globalDefault)?.name ?? "direct";
  return [
    { mode: "inherit", label: `Inherit from parent — currently: ${describeProxy(parent, proxies)}` },
    { mode: "global", label: `Use global setting — currently: ${global}` },
    { mode: "none", label: "No proxy (direct)" },
    { mode: "proxy", label: "Use proxy…" },
  ];
}

// The node's effective proxy (what a send uses).
export function effectiveProxy(tree: Tree, id: string, globalDefault: string, proxies: ProxyRef[]): ResolvedProxy {
  const known = (pid: string) => proxies.some((p) => p.id === pid);
  return resolveProxyInTree(tree, id, globalDefault, known) ?? { proxyId: null, source: { kind: "global" } };
}

// The node's stored value from the tree.
export function ownProxy(tree: Tree, id: string): NodeProxy {
  const node = tree.requests.get(id) ?? tree.folders.get(id);
  return node?.proxy ?? { mode: "inherit", proxyId: null };
}

// The override dot: anything but inherit (a deleted proxy counts as inherit).
export const proxyOverrides = (own: NodeProxy, proxies: ProxyRef[]) => shownProxy(own, proxies).mode !== "inherit";

// A choice from the row → what to save. "Use proxy…" needs a proxy: the first
// one when none is picked yet; undefined when the project has none.
export function choiceToSave(mode: ProxyMode, picked: string | null, proxies: ProxyRef[]): NodeProxy | undefined {
  if (mode !== "proxy") return { mode, proxyId: null };
  const id = picked && proxies.some((p) => p.id === picked) ? picked : proxies[0]?.id;
  return id ? { mode: "proxy", proxyId: id } : undefined;
}

// The bypass field's hint.
export const BYPASS_HINT = "Comma-separated hosts that go direct, e.g. localhost, 127.0.0.1, *.internal.corp (any subdomain, not internal.corp itself), api.example.com";

// The Settings modal's global-default dropdown value: a proxy no longer in the
// project's list reads as "none" (which is also how it resolves).
export const globalChoice = (globalDefault: string, proxies: ProxyRef[]) =>
  proxies.some((p) => p.id === globalDefault) ? globalDefault : "none";

// The proxy tab's password status line.
export function passwordStatus(s: { saving: boolean; error?: string; set: boolean; username: string }): string {
  if (s.saving) return "Saving on this machine…";
  if (s.error) return `Not saved: ${s.error}`;
  if (s.set) return "Saved on this machine — never sent to the server";
  return s.username ? "No password on this machine: sends go without credentials" : "";
}

// The ● marker on the sidebar row of the project's global default proxy, and
// whether "Set as global default" applies (not to the one that already is).
export const isGlobalDefault = (id: string, globalDefault: string) => id === globalDefault;

export function setDefaultEntry(id: string, globalDefault: string): { disabled: boolean; title?: string } {
  return isGlobalDefault(id, globalDefault) ? { disabled: true, title: "Already the global default" } : { disabled: false };
}
