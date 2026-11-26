// The project's recently used header keys (local, Go settings: newest first, ≤ 30)
// for the headers table's key completion (headerComplete.ts). Loaded when the
// project changes; a key committed in a header row is recorded in canonical casing.
import { createSignal } from "solid-js";
import { AddRecentHeaderKey, GetRecentHeaderKeys } from "../wailsjs/go/main/App";
import { canonicalHeader } from "./headerComplete";

const [recent, setRecent] = createSignal<readonly string[]>([]);
let project = "";

export const recentHeaderKeys = recent;

export async function loadRecentHeaderKeys(projectId: string) {
  project = projectId;
  setRecent([]);
  if (!projectId) return;
  const keys = await GetRecentHeaderKeys(projectId);
  if (project === projectId) setRecent(keys ?? []);
}

export async function commitHeaderKey(key: string) {
  const k = canonicalHeader(key);
  if (!project || !k || recent()[0] === k) return;
  const p = project;
  const keys = await AddRecentHeaderKey(p, k);
  if (project === p) setRecent(keys ?? []);
}
