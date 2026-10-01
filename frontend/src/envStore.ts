import { createMemo, createRoot, createSignal } from "solid-js";
import { GetEnvContext, SetActiveEnvironment } from "../wailsjs/go/main/App";
import { envs, main } from "../wailsjs/go/models";
import { handleProblem } from "./authStore";
import { EnvDisplay, NO_ENV, VarInfo } from "./vars";

// The current project's environment context, for the env switcher and for
// {{var}} highlighting/hover. Refreshed on project change, env switch and variable
// edits — hovering only reads this store and never calls the bridge.
const [context, setContext] = createSignal<envs.EnvContext>();
const [projectId, setProjectId] = createSignal("");
const [error, setError] = createSignal<string>();

export { context as envContext, error as envError };

function apply(pid: string, result: main.EnvContextResult) {
  if (pid !== projectId()) return; // project switched meanwhile
  handleProblem(result.error);
  setError(result.error?.message);
  if (result.data) setContext(result.data);
}

export async function loadEnvContext(pid: string) {
  if (pid !== projectId()) {
    setProjectId(pid);
    setContext(undefined);
  }
  if (!pid) return;
  apply(pid, await GetEnvContext(pid));
}

export async function selectEnvironment(envId: string) {
  const pid = projectId();
  if (pid) apply(pid, await SetActiveEnvironment(pid, envId));
}

export const refreshEnvContext = () => loadEnvContext(projectId());

// The highlighter's view of the active environment.
// (Module-level, so it lives in its own root for the app's lifetime.)
export const envDisplay = createRoot(() => createMemo<EnvDisplay>(() => {
  const ctx = context();
  if (!ctx || !ctx.active_id) return NO_ENV;
  const vars = new Map<string, VarInfo>();
  for (const v of ctx.variables) {
    vars.set(v.key, { key: v.key, value: v.value, secret: v.type === "secret", hasValue: v.has_value });
  }
  return { envName: ctx.active_name, vars };
}));
