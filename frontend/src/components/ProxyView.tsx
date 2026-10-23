import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { GetProxyPassword, SetProxyPassword, UpdateProxy } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import { handleProblem } from "../authStore";
import { createAutosaver, SaveState } from "../autosave";
import { BYPASS_HINT, passwordStatus } from "../proxySettings";
import { proxyById, reloadProxies } from "../proxyStore";
import FormError from "./FormError";
import Icon from "./Icon";
import SaveIndicator from "./SaveIndicator";

interface Props {
  proxyId: string;
}

const SAVE_DELAY_MS = 600;
const TYPES = [
  { id: "http", label: "HTTP" },
  { id: "https", label: "HTTPS" },
  { id: "socks5", label: "SOCKS5" },
];

type Form = main.ProxyInput;

const formOf = (p: { name: string; proxy_type: string; host: string; port: number; username: string; bypass: string }): Form =>
  main.ProxyInput.createFrom({ name: p.name, proxy_type: p.proxy_type, host: p.host, port: p.port, username: p.username, bypass: p.bypass });

// One proxy's tab (like an environment's): its connection details — shared with
// the team, autosaved like a request (600 ms, changed fields only) — and its
// PASSWORD, which is stored only on this machine (local SQLite; never sent to
// the server) and saved as you type.
export default function ProxyView(props: Props) {
  const [form, setForm] = createSignal<Form>();
  const [portText, setPortText] = createSignal("");
  const [saveState, setSaveState] = createSignal<SaveState>("idle");
  const [saveError, setSaveError] = createSignal<string>();
  const [password, setPassword] = createSignal("");
  const [passwordSet, setPasswordSet] = createSignal(false);
  const [reveal, setReveal] = createSignal(false);
  const [pwState, setPwState] = createSignal<SaveState>("idle");
  const [pwError, setPwError] = createSignal<string>();
  let base: Form | undefined;

  // The form follows the server's copy (list re-fetches) until it is edited.
  createEffect(on(() => proxyById(props.proxyId), (p) => {
    if (!p) return;
    const next = formOf(p);
    if (!base || (JSON.stringify(form()) === JSON.stringify(base) && saveState() !== "saving")) {
      base = next;
      setForm(next);
      setPortText(String(next.port));
    }
  }));
  createEffect(on(() => props.proxyId, async (id) => {
    const r = await GetProxyPassword(id);
    handleProblem(r.error);
    if (r.data) {
      setPassword(r.data.password);
      setPasswordSet(r.data.set);
    }
  }));

  const portValid = () => /^\d+$/.test(portText().trim()) && +portText() >= 1 && +portText() <= 65535;

  const saver = createAutosaver({
    delayMs: SAVE_DELAY_MS,
    onState: (s) => {
      setSaveState(s);
      if (s !== "error") setSaveError(undefined);
    },
    save: async () => {
      const f = form();
      if (!f || !base || !portValid()) return true;
      if (JSON.stringify(f) === JSON.stringify(base)) return true;
      const r = await UpdateProxy(props.proxyId, base, f);
      handleProblem(r.error);
      if (r.error || !r.data) {
        setSaveError(r.error?.message);
        return false;
      }
      base = formOf(r.data);
      void reloadProxies(); // names / labels everywhere follow the server
      return true;
    },
  });
  const edit = (patch: Partial<Form>) => {
    setForm((f) => (f ? main.ProxyInput.createFrom({ ...f, ...patch }) : f));
    saver.change();
  };

  const pwSaver = createAutosaver({
    delayMs: 400,
    onState: (s) => {
      setPwState(s);
      if (s !== "error") setPwError(undefined);
    },
    save: async () => {
      const r = await SetProxyPassword(props.proxyId, password());
      handleProblem(r.error);
      if (r.error) {
        setPwError(r.error.message);
        return false;
      }
      setPasswordSet(password() !== "");
      return true;
    },
  });
  onCleanup(() => {
    void saver.flush().then(() => saver.dispose());
    void pwSaver.flush().then(() => pwSaver.dispose());
  });

  return (
    <div class="proxy-view">
      <Show when={form()} fallback={<p class="placeholder">Loading…</p>}>
        {(f) => (
          <>
            <header class="proxy-head">
              <h2 class="webhook-name">{f().name || "Proxy"}</h2>
              <span class="muted small">{f().proxy_type}://{f().host}:{portText()}</span>
              <span class="row-spacer" />
              <SaveIndicator state={saveState()} error={saveError()} onRetry={() => void saver.retry()} />
            </header>
            <div class="proxy-form">
              <label class="proxy-field">
                <span>Name</span>
                <input type="text" value={f().name} maxLength={100} onInput={(e) => edit({ name: e.currentTarget.value })} />
              </label>
              <div class="proxy-field">
                <span>Type</span>
                <div class="segmented" role="radiogroup" aria-label="Proxy type">
                  <For each={TYPES}>
                    {(t) => (
                      <button type="button" role="radio" aria-checked={f().proxy_type === t.id} classList={{ active: f().proxy_type === t.id }}
                        onClick={() => edit({ proxy_type: t.id })}>{t.label}</button>
                    )}
                  </For>
                </div>
              </div>
              <div class="proxy-row">
                <label class="proxy-field grow">
                  <span>Host</span>
                  <input type="text" value={f().host} spellcheck={false} placeholder="proxy.example.com"
                    onInput={(e) => edit({ host: e.currentTarget.value })} />
                </label>
                <label class="proxy-field port">
                  <span>Port</span>
                  <input type="text" inputmode="numeric" maxLength={5} value={portText()} aria-invalid={!portValid()}
                    onInput={(e) => {
                      setPortText(e.currentTarget.value);
                      if (portValid()) edit({ port: +e.currentTarget.value });
                    }} />
                </label>
              </div>
              <Show when={!portValid()}><p class="form-error inline small">Port must be a number between 1 and 65535</p></Show>
              <div class="proxy-row">
                <label class="proxy-field grow">
                  <span>Username</span>
                  <input type="text" value={f().username} spellcheck={false} autocomplete="off" placeholder="(none)"
                    onInput={(e) => edit({ username: e.currentTarget.value })} />
                </label>
                <div class="proxy-field grow">
                  <span>Password <span class="muted small">— stored only on this machine</span></span>
                  <div class="proxy-password">
                    <input type={reveal() ? "text" : "password"} value={password()} autocomplete="new-password" spellcheck={false}
                      aria-label="Proxy password" placeholder={f().username ? "not set on this machine" : "(none)"}
                      onInput={(e) => {
                        setPassword(e.currentTarget.value);
                        pwSaver.change();
                      }} />
                    <button type="button" class="icon-button" aria-label={reveal() ? "Hide password" : "Show password"}
                      title={reveal() ? "Hide" : "Show"} onClick={() => setReveal(!reveal())}>
                      <Icon name={reveal() ? "eye-off" : "eye"} size={14} />
                    </button>
                  </div>
                  <span class="muted small proxy-pw-state" aria-live="polite">
                    {passwordStatus({ saving: pwState() === "pending" || pwState() === "saving", error: pwError(), set: passwordSet(), username: f().username })}
                  </span>
                </div>
              </div>
              <label class="proxy-field">
                <span>Bypass</span>
                <input type="text" value={f().bypass} spellcheck={false} placeholder="localhost, *.internal.corp"
                  onInput={(e) => edit({ bypass: e.currentTarget.value })} />
                <span class="muted small">{BYPASS_HINT}</span>
              </label>
              <FormError message={saveError()} />
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
