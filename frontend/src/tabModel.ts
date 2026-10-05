// Pure tab logic (typed tabs, persistence format, reordering, shortcut rules).
// No Solid, no bindings — unit-tested in tabModel.test.ts.

export type TabKind = "request" | "env" | "env_list";

export interface TabRef {
  kind: TabKind;
  id: string; // request id / environment id; "" for env_list
}

export const ENV_LIST: TabRef = { kind: "env_list", id: "" };

export const tabKey = (ref: TabRef) => `${ref.kind}:${ref.id}`;
export const sameTab = (a: TabRef | undefined, b: TabRef | undefined) => !!a && !!b && a.kind === b.kind && a.id === b.id;

export interface SavedTabs {
  open: TabRef[];
  active?: TabRef;
}

function toRef(v: unknown): TabRef | undefined {
  // The pre-typed format stored bare request ids.
  if (typeof v === "string") return v ? { kind: "request", id: v } : undefined;
  if (!v || typeof v !== "object") return undefined;
  const { kind, id } = v as { kind?: unknown; id?: unknown };
  const sid = typeof id === "string" ? id : "";
  if (kind === "request" || kind === "env") return sid ? { kind, id: sid } : undefined;
  if (kind === "env_list") return ENV_LIST;
  return undefined;
}

// Accepts both the typed format and the old {open: ["id"], active: "id"}; drops
// unknown entries and duplicates, and an active tab that is not open.
export function normalizeSaved(raw: unknown): SavedTabs {
  const obj = (raw && typeof raw === "object" ? raw : {}) as { open?: unknown; active?: unknown };
  const open: TabRef[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(obj.open) ? obj.open : []) {
    const ref = toRef(entry);
    if (ref && !seen.has(tabKey(ref))) {
      seen.add(tabKey(ref));
      open.push(ref);
    }
  }
  const active = toRef(obj.active);
  return { open, active: active && seen.has(tabKey(active)) ? active : undefined };
}

// Moves the item at `from` so that it lands at insertion slot `drop`, where slots
// are counted between the ORIGINAL positions (0 = before the first tab,
// length = after the last). Returns the same array when nothing moves.
export function reorder<T>(list: T[], from: number, drop: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const slot = Math.max(0, Math.min(drop, list.length));
  if (slot === from || slot === from + 1) return list; // dropped onto itself
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(slot > from ? slot - 1 : slot, 0, item);
  return out;
}

// The insertion slot for a pointer at x, given each tab's left/right edges in order.
export function dropSlot(x: number, rects: { left: number; right: number }[]): number {
  for (let i = 0; i < rects.length; i++) {
    if (x < (rects[i].left + rects[i].right) / 2) return i;
  }
  return rects.length;
}

// Ctrl/Cmd+Enter sends only for an idle request tab with no modal open.
export function canSendShortcut(s: { activeKind?: TabKind; modalOpen: boolean; sending: boolean }): boolean {
  return s.activeKind === "request" && !s.modalOpen && !s.sending;
}

export const isSendShortcut = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }) =>
  e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;

// What to do with environment tabs after the project's environment list changes:
// relabel renamed ones, close deleted ones.
export function syncEnvTabs(
  tabs: { ref: TabRef; name: string }[],
  envs: { id: string; name: string }[],
): { rename: { ref: TabRef; name: string }[]; close: TabRef[] } {
  const byId = new Map(envs.map((e) => [e.id, e.name]));
  const rename: { ref: TabRef; name: string }[] = [];
  const close: TabRef[] = [];
  for (const t of tabs) {
    if (t.ref.kind !== "env") continue;
    const name = byId.get(t.ref.id);
    if (name === undefined) close.push(t.ref);
    else if (name !== t.name) rename.push({ ref: t.ref, name });
  }
  return { rename, close };
}
