import { createSignal } from "solid-js";
import { Register } from "../../wailsjs/go/main/App";
import { setAuthState } from "../authStore";
import FormError from "./FormError";
import GearButton from "./GearButton";

interface Props {
  onShowLogin: () => void;
  onOpenSettings: () => void;
}

export default function RegisterScreen(props: Props) {
  const [name, setName] = createSignal("");
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
      const result = await Register(email(), password(), name());
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
        <h1>Create your account</h1>
        <label class="field">
          <span>Name</span>
          <input type="text" autocomplete="name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Email</span>
          <input type="email" autocomplete="username" required value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" autocomplete="new-password" required value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        <button class="primary" type="submit" disabled={pending()}>
          {pending() ? "Creating account…" : "Create account"}
        </button>
        <FormError message={error()} />
        <p class="auth-switch">
          Already have an account?{" "}
          <button type="button" class="link" onClick={() => props.onShowLogin()}>
            Log in
          </button>
        </p>
      </form>
    </div>
  );
}
