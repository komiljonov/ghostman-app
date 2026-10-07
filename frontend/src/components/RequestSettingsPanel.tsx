import { For } from "solid-js";
import { redirectDefault } from "../redirectDefault";
import { effectiveFollow, modeLabel, REDIRECT_MODES, RedirectMode } from "../requestSettings";
import FormError from "./FormError";

interface Props {
  mode: RedirectMode;
  error?: string;
  onMode: (mode: RedirectMode) => void;
}

// The request's Settings sub-tab: client options for this request only, stored on
// this machine. Today: follow redirects — the global default (Settings) or an override.
export default function RequestSettingsPanel(props: Props) {
  const follows = () => effectiveFollow(props.mode, redirectDefault());
  return (
    <div class="request-settings">
      <fieldset class="request-setting">
        <legend>Follow redirects</legend>
        <For each={REDIRECT_MODES}>
          {(m) => (
            <label class="choice">
              <input type="radio" name="follow-redirects" value={m} checked={props.mode === m}
                onChange={() => props.onMode(m)} />
              {modeLabel(m, redirectDefault())}
            </label>
          )}
        </For>
        <p class="request-setting-hint">
          {follows()
            ? "Redirects are followed (up to 10); the timing panel shows every hop."
            : "Redirects are not followed: a 3xx response is shown as it is, with its Location header."}
          {" "}The default is set in Settings. Stored on this machine only.
        </p>
        <FormError message={props.error} />
      </fieldset>
    </div>
  );
}
