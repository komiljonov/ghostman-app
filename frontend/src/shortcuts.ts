// App-wide keyboard shortcuts: Ctrl/Cmd+Enter (send), Ctrl+Tab / Ctrl+Shift+Tab
// (next/previous tab), Ctrl/Cmd+W (close tab). One action table, two entry points:
// the window keydown handler (MainScreen) and a highest-precedence CodeMirror keymap
// (codemirror.ts), so editors cannot swallow them. Whoever handles a key first runs
// the action; the window handler skips events CodeMirror already handled
// (defaultPrevented).
import type { ShortcutAction } from "./tabModel";

let handlers: Partial<Record<ShortcutAction, () => void>> = {};

export function setShortcutHandlers(next: Partial<Record<ShortcutAction, () => void>>) {
  handlers = next;
}

export function runShortcut(action: ShortcutAction): boolean {
  handlers[action]?.();
  return true; // consumed either way: e.g. Ctrl+Enter never inserts a line
}

export const triggerSend = () => runShortcut("send");
