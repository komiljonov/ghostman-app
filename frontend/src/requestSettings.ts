// Follow redirects: a cascading setting (settingsResolver.ts). Requests and
// folders store inherit | global | on | off on the server (shared with the team);
// the global value is local to this machine (Settings). These helpers build the
// UI labels and wire saving; resolution itself is settingsResolver.ts.
import type { session } from "../wailsjs/go/models";
import { GLOBAL, INHERIT, Resolved, resolveInTree, resolveParent, sourceLabel } from "./settingsResolver";
import type { Tree } from "./tree";

export type FollowValue = "inherit" | "global" | "on" | "off";

export const FOLLOW_VALUES: FollowValue[] = ["inherit", "global", "on", "off"];

export const asFollowValue = (v: string | undefined): FollowValue =>
  v === "global" || v === "on" || v === "off" ? v : "inherit";

const explicitFollow = (v: string): boolean | undefined => (v === "on" ? true : v === "off" ? false : undefined);

const onOff = (b: boolean) => (b ? "on" : "off");

// The effective value for a request or folder (default: the global value).
export function resolveFollow(tree: Tree, id: string, globalFollow: boolean): Resolved<boolean> {
  return resolveInTree(tree, id, "follow_redirects", globalFollow, explicitFollow) ?? { value: globalFollow, source: { kind: "global" } };
}

export interface FollowOption {
  value: FollowValue;
  label: string;
}

// The four choices with live "currently" labels. For "inherit" it names where the
// value would come from (the nearest folder with a value, or global).
export function followOptions(tree: Tree, id: string, globalFollow: boolean): FollowOption[] {
  const parent = resolveParent(tree, id, "follow_redirects", globalFollow, explicitFollow)
    ?? { value: globalFollow, source: { kind: "global" as const } };
  return [
    { value: INHERIT, label: `Inherit from parent — currently: ${onOff(parent.value)} (${sourceLabel(parent.source)})` },
    { value: GLOBAL, label: `Use global setting — currently: ${onOff(globalFollow)}` },
    { value: "on", label: "Always follow" },
    { value: "off", label: "Never follow" },
  ];
}

// The node's own stored value.
export function ownFollow(tree: Tree, id: string): FollowValue {
  const node = tree.requests.get(id) ?? tree.folders.get(id);
  return asFollowValue(node?.settings.follow_redirects);
}

// Save a value on the server, then re-fetch the tree (server data is never patched
// locally; everything under the node re-resolves from the fresh lists).
export async function saveFollow(
  id: string, value: FollowValue,
  deps: { set: (id: string, value: string) => Promise<{ error?: session.Problem }>; reload: () => void | Promise<void> },
): Promise<session.Problem | undefined> {
  const result = await deps.set(id, value);
  if (result.error) return result.error;
  await deps.reload();
  return undefined;
}

// The global value: optimistic save + revert (local setting, no server).
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
