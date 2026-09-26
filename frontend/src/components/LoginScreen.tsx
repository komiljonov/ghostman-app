import { createSignal } from "solid-js";
import { Login } from "../../wailsjs/go/main/App";
import { setAuthState } from "../authStore";
import FormError from "./FormError";
import GearButton from "./GearButton";

interface Props {
  onShowRegister: () => void;
  onOpenSettings: () => void;
}

export default function LoginScreen(props: Props) {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (pending()) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await Login(email(), password());
      setError(result.error?.message);
      setAuthState(result.state);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="center-screen">
      <div class="screen-corner">
        <GearButton onClick={props.onOpenSettings} />
      </div>
      <form class="auth-card" onSubmit={submit}>
        <h1>Log in to Ghostman</h1>
        <label class="field">
          <span>Email</span>
          <input type="email" autocomplete="username" required value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" autocomplete="current-password" required value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        <button class="primary" type="submit" disabled={pending()}>
          {pending() ? "Logging in…" : "Log in"}
        </button>
        <FormError message={error()} />
        <p class="auth-switch">
          No account?{" "}
          <button type="button" class="link" onClick={() => props.onShowRegister()}>
            Create one
          </button>
        </p>
      </form>
    </div>
  );
}
