// The global follow-redirects value (local, Settings) as a signal, so every
// "Use global" / inherit-to-the-top label re-resolves live when it changes.
import { createSignal } from "solid-js";
import { GetFollowRedirectsDefault, SetFollowRedirectsDefault } from "../wailsjs/go/main/App";
import { changeRedirectDefault } from "./requestSettings";

const [value, setValue] = createSignal(true);

export const redirectDefault = value;

export async function initRedirectDefault() {
  try {
    setValue(await GetFollowRedirectsDefault());
  } catch {
    // bridge not ready: keep "on"
  }
}

export const setRedirectDefault = (next: boolean) =>
  changeRedirectDefault(value(), next, { set: SetFollowRedirectsDefault, show: setValue });
