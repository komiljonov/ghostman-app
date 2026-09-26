import { createSignal } from "solid-js";
import { Logout } from "../../wailsjs/go/main/App";
import { authState, setAuthState } from "../authStore";
import GearButton from "./GearButton";
import Workspace from "./Workspace";

interface Props {
  onOpenSettings: () => void;
}

export default function MainScreen(props: Props) {
  const [pending, setPending] = createSignal(false);

  const logout = async () => {
    setPending(true);
    try {
      setAuthState(await Logout());
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="main-screen">
      <header class="topbar">
        <strong class="brand">Ghostman</strong>
        <div class="topbar-user">
          <span class="user-name">{authState().user?.name || "(no name)"}</span>
          <span class="muted">{authState().user?.email}</span>
          <GearButton onClick={props.onOpenSettings} />
          <button type="button" onClick={logout} disabled={pending()}>
            {pending() ? "Logging out…" : "Log out"}
          </button>
        </div>
      </header>
      <Workspace />
    </div>
  );
}
