// One app-wide notice (AppNotice.tsx, bottom right): confirmations of actions
// that have no pane of their own, like "Copy as curl" from a tree or tab menu.
import { createSignal } from "solid-js";

export interface Notice {
  text: string;
  error: boolean;
}

const [notice, setNotice] = createSignal<Notice>();
let timer: ReturnType<typeof setTimeout> | undefined;

export const appNotice = notice;

export function flashNotice(text: string, error = false) {
  clearTimeout(timer);
  setNotice({ text, error });
  timer = setTimeout(() => setNotice(undefined), error ? 8000 : 3000);
}

export const dismissNotice = () => setNotice(undefined);
