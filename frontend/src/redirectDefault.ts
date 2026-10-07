// The global "follow redirects" default as a signal, so requests set to "Use
// default" show the current value live when Settings changes it.
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
