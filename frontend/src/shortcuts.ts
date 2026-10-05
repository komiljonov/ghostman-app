// The app-wide "send" shortcut (Ctrl+Enter, Cmd+Enter on macOS). One action, two
// entry points: the window keydown handler (MainScreen) and a highest-precedence
// CodeMirror binding (codemirror.ts), so editors that bind Mod-Enter themselves
// cannot swallow it. Whoever handles the key first calls triggerSend(); the window
// handler skips events CodeMirror already handled (defaultPrevented).
let handler: (() => void) | undefined;

export function setSendShortcutHandler(fn: (() => void) | undefined) {
  handler = fn;
}

export function triggerSend(): boolean {
  handler?.();
  return true; // the key is consumed either way: Ctrl+Enter never inserts a line
}
