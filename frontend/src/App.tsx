import { createEffect, createSignal, Match, onMount, Show, Switch } from "solid-js";
import { authState, loadAuthState } from "./authStore";
import LoginScreen from "./components/LoginScreen";
import RegisterScreen from "./components/RegisterScreen";
import UnreachableScreen from "./components/UnreachableScreen";
import MainScreen from "./components/MainScreen";
import SettingsModal from "./components/SettingsModal";

export default function App() {
  const [authView, setAuthView] = createSignal<"login" | "register">("login");
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const openSettings = () => setSettingsOpen(true);

  // After any session (e.g. register, then log out) the next auth screen is Login.
  createEffect(() => {
    if (authState().state === "logged_in") setAuthView("login");
  });

  onMount(loadAuthState);

  return (
    <>
      <Switch>
        <Match when={authState().state === "loading"}>
          <div class="center-screen">
            <p class="placeholder">Connecting to server…</p>
          </div>
        </Match>
        <Match when={authState().state === "unreachable"}>
          <UnreachableScreen />
        </Match>
        <Match when={authState().state === "logged_out" && authView() === "register"}>
          <RegisterScreen onShowLogin={() => setAuthView("login")} onOpenSettings={openSettings} />
        </Match>
        <Match when={authState().state === "logged_out"}>
          <LoginScreen onShowRegister={() => setAuthView("register")} onOpenSettings={openSettings} />
        </Match>
        <Match when={authState().state === "logged_in"}>
          <MainScreen onOpenSettings={openSettings} />
        </Match>
      </Switch>
      <Show when={settingsOpen()}>
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      </Show>
    </>
  );
}
