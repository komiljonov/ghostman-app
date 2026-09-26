import { createSignal, Show } from "solid-js";
import { SetServerURL } from "../../wailsjs/go/main/App";
import { authState, setAuthState } from "../authStore";
import FormError from "./FormError";

export default function UnreachableScreen() {
  const [url, setUrl] = createSignal(authState().serverUrl);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();

  // Saving the URL (changed or not) re-runs the connection check on the Go side.
  const retry = async (e: SubmitEvent) => {
    e.preventDefault();
    if (pending()) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await SetServerURL(url());
      setError(result.error?.message);
      setAuthState(result.state);
      setUrl(result.state.serverUrl);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="center-screen">
      <form class="auth-card" onSubmit={retry}>
        <h1>Cannot reach server</h1>
        <p>
          Cannot reach server at <code>{authState().serverUrl}</code>
        </p>
        <Show when={authState().message}>
          <p class="muted">Reason: {authState().message}</p>
        </Show>
        <label class="field">
          <span>Server URL</span>
          <input type="text" spellcheck={false} value={url()} onInput={(e) => setUrl(e.currentTarget.value)} />
        </label>
        <button class="primary" type="submit" disabled={pending()}>
          {pending() ? "Connecting…" : "Retry"}
        </button>
        <FormError message={error()} />
      </form>
    </div>
  );
}
