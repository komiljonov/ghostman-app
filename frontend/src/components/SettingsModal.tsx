import { createSignal, onMount, Show } from "solid-js";
import { GetSettings, SetServerURL } from "../../wailsjs/go/main/App";
import { authState, setAuthState } from "../authStore";
import FormError from "./FormError";
import { setThemePref, themePref } from "../themeStore";
import { asPref } from "../theme";
import { redirectDefault, setRedirectDefault } from "../redirectDefault";

interface Props {
  onClose: () => void;
}

export default function SettingsModal(props: Props) {
  const [themeError, setThemeError] = createSignal<string>();
  const [redirectError, setRedirectError] = createSignal<string>();
  const [original, setOriginal] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [confirming, setConfirming] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();

  onMount(async () => {
    const settings = await GetSettings();
    setOriginal(settings.serverUrl);
    setUrl(settings.serverUrl);
  });

  const loggedIn = () => authState().state === "logged_in";
  const changed = () => url().trim() !== original();

  const apply = async () => {
    setPending(true);
    setError(undefined);
    try {
      const result = await SetServerURL(url());
      setAuthState(result.state);
      if (result.error) {
        setError(result.error.message);
        setConfirming(false);
        return;
      }
      props.onClose();
    } finally {
      setPending(false);
    }
  };

  const save = (e: SubmitEvent) => {
    e.preventDefault();
    if (pending()) return;
    if (!changed()) {
      props.onClose();
      return;
    }
    if (loggedIn() && !confirming()) {
      setConfirming(true);
      return;
    }
    void apply();
  };

  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onSubmit={save}
        onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
        <h2 id="settings-title">Settings</h2>
        <label class="field">
          <span>Theme</span>
          <select aria-label="Theme" value={themePref()} onChange={(e) => {
            const v = asPref(e.currentTarget.value);
            void setThemePref(v).then((err) => setThemeError(err));
          }}>
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <FormError message={themeError()} />
        <label class="choice settings-check">
          <input type="checkbox" checked={redirectDefault()}
            onChange={(e) => void setRedirectDefault(e.currentTarget.checked).then((err) => setRedirectError(err?.message))} />
          Follow redirects (global setting)
        </label>
        <p class="settings-hint">
          Used by requests and folders set to “Use global”, and wherever “Inherit” reaches the top.
          On this machine only; applies right away.
        </p>
        <FormError message={redirectError()} />
        <label class="field">
          <span>Server URL</span>
          <input type="text" spellcheck={false} autofocus value={url()} disabled={confirming()}
            onInput={(e) => {
              setUrl(e.currentTarget.value);
              setError(undefined);
            }} />
        </label>
        <FormError message={error()} />
        <Show when={confirming()}>
          <p class="warning" role="alert">
            Changing the server will log you out. Continue?
          </p>
        </Show>
        <div class="modal-actions">
          <button type="button" onClick={() => (confirming() ? setConfirming(false) : props.onClose())}>
            {confirming() ? "Back" : "Cancel"}
          </button>
          <button class={confirming() ? "danger" : "primary"} type="submit" disabled={pending()}>
            {pending() ? "Saving…" : confirming() ? "Log out and switch" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
