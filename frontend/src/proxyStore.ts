// The current project's proxies and its global default proxy (local setting
// proxy_global_<project_id>), for the Settings rows' live labels, the proxy tabs
// and send-time resolution. Re-fetched on project change and after every
// mutation (server data is never patched locally).
import { createSignal } from "solid-js";
import { GetProxyGlobal, ListProxies, SetProxyGlobal } from "../wailsjs/go/main/App";
import type { api } from "../wailsjs/go/models";
import { handleProblem } from "./authStore";

const [proxies, setProxies] = createSignal<api.Proxy[]>([]);
const [loaded, setLoaded] = createSignal(false);
const [error, setError] = createSignal<string>();
const [globalDefault, setGlobalDefault] = createSignal("none");
let project = "";
let seq = 0;

export { proxies, loaded as proxiesLoaded, error as proxiesError, globalDefault as proxyGlobal };

export async function loadProxies(projectId: string): Promise<void> {
  if (projectId !== project) {
    project = projectId;
    setProxies([]);
    setLoaded(false);
    setGlobalDefault("none");
  }
  if (!projectId) return;
  const mine = ++seq;
  const [list, global] = await Promise.all([ListProxies(projectId), GetProxyGlobal(projectId)]);
  if (mine !== seq) return;
  handleProblem(list.error);
  setError(list.error?.message);
  setGlobalDefault(global || "none");
  if (list.data) {
    setProxies(list.data);
    setLoaded(true);
  }
}

export const reloadProxies = () => loadProxies(project);

export const proxyById = (id: string | null | undefined) => (id ? proxies().find((p) => p.id === id) : undefined);
export const knownProxy = (id: string) => !!proxyById(id);

// The global default (Settings modal): saved locally, shown at once.
export async function chooseGlobalProxy(value: string): Promise<string | undefined> {
  if (!project) return "open a project first";
  const before = globalDefault();
  setGlobalDefault(value);
  const r = await SetProxyGlobal(project, value);
  handleProblem(r.error);
  if (r.error) {
    setGlobalDefault(before);
    return r.error.message;
  }
  return undefined;
}
