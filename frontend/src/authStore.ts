import { createSignal } from "solid-js";
import { GetAuthState } from "../wailsjs/go/main/App";
import { session } from "../wailsjs/go/models";

// App-level auth state. Go decides the state; the UI only stores what Go returns
// and renders the matching screen.
const [authState, setAuthState] = createSignal<session.AuthState>(
  session.AuthState.createFrom({ state: "loading", serverUrl: "" }),
);

export { authState, setAuthState };

export async function loadAuthState() {
  setAuthState(await GetAuthState());
}

// A 401 from any server call means the session ended; the Go side has already
// re-checked it, so reloading the state shows the login screen.
export function handleProblem(problem: session.Problem | undefined) {
  if (problem?.kind === "server" && problem.status === 401) void loadAuthState();
}
