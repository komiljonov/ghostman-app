import { For, Match, Show, Switch } from "solid-js";
import { Row } from "../rows";
import { applyUrlInput, serializeUrl } from "../urlParams";
import { TabsController, TabState } from "../tabsController";
import BodyEditor from "./BodyEditor";
import KeyValueEditor from "./KeyValueEditor";
import RequestSettingsPanel from "./RequestSettingsPanel";
import RequestHistoryPanel from "./RequestHistoryPanel";
import AuthEditor from "./AuthEditor";
import { effectiveAuthOf, modeOptions, overridesSomething } from "../auth";
import { ownFollow } from "../requestSettings";
import { currentTree } from "../treeStore";
import ResponseView from "./ResponseView";
import SaveIndicator from "./SaveIndicator";
import UrlEditor from "./UrlEditor";

interface Props {
  tab: TabState;
  controller: TabsController;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const countRows = (rows: Row[]) => rows.filter((r) => r.key.trim() !== "").length;

// One tab's editor: method/URL/Send, Params | Headers | Body | Auth | Settings | History, and the response
// below a draggable divider. Every edit autosaves (see tabsController).
export default function RequestEditor(props: Props) {
  let split!: HTMLDivElement;
  const id = () => props.tab.id;
  const edit = (fn: Parameters<TabsController["edit"]>[1]) => props.controller.edit(id(), fn);
  const view = (fn: (t: TabState) => void) => props.controller.view(id(), fn);

  const startDrag = (e: PointerEvent) => {
    e.preventDefault();
    const rect = split.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const share = (rect.bottom - ev.clientY) / rect.height;
      view((t) => (t.responseShare = Math.min(0.85, Math.max(0.15, share))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // One rule for the sub-tab dots: the request sets something itself.
  const overrides = () => overridesSomething({ authType: props.tab.draft.auth.type, follow: ownFollow(currentTree(), props.tab.id) });

  const sections = [
    { id: "params" as const, label: "Params", count: () => countRows(props.tab.draft.query_params) },
    { id: "headers" as const, label: "Headers", count: () => countRows(props.tab.draft.headers) },
    { id: "body" as const, label: "Body", count: () => 0 },
    { id: "auth" as const, label: "Auth", count: () => 0 },
    { id: "settings" as const, label: "Settings", count: () => 0 },
    { id: "history" as const, label: "History", count: () => 0 },
  ];

  return (
    <Switch>
      <Match when={props.tab.status === "loading"}>
        <p class="placeholder editor-note">Loading request…</p>
      </Match>
      <Match when={props.tab.status === "error"}>
        <p class="form-error editor-note">{props.tab.loadError ?? "Could not load this request."}</p>
      </Match>
      <Match when={props.tab.status === "ready"}>
        <div class="request-editor">
          <form class="url-bar" onSubmit={(e) => {
            e.preventDefault();
            if (!props.tab.sending) void props.controller.send(id());
          }}>
            <select class={`method-select method-${props.tab.draft.method}`} aria-label="HTTP method"
              value={props.tab.draft.method}
              onChange={(e) => {
                const m = e.currentTarget.value;
                edit((d) => (d.method = m));
              }}>
              <For each={METHODS}>{(m) => <option value={m}>{m}</option>}</For>
            </select>
            {/* Shows base url + enabled params; typing updates both (urlParams.ts). */}
            <UrlEditor value={serializeUrl(props.tab.draft.url, props.tab.draft.query_params)}
              onChange={(text) => edit((d) => {
                const next = applyUrlInput(text, d.query_params);
                d.url = next.url;
                if (next.rows !== d.query_params) d.query_params = next.rows;
              })}
              onEnter={() => {
                if (!props.tab.sending) void props.controller.send(id());
              }} />
            {/* Send and Cancel share one fixed-width slot, pinned to the right. */}
            <Show when={props.tab.sending} fallback={<button class="send" type="submit">Send</button>}>
              <button class="send cancel" type="button" onClick={() => props.controller.cancel(id())}>Cancel</button>
            </Show>
          </form>

          <div class="editor-split" ref={split}>
            <div class="editor-config" style={{ flex: `${1 - props.tab.responseShare} 1 0` }}>
              <div class="section-tabs" role="tablist">
                <For each={sections}>
                  {(s) => (
                    <button type="button" role="tab" aria-selected={props.tab.section === s.id}
                      classList={{ active: props.tab.section === s.id }}
                      onClick={() => view((t) => (t.section = s.id))}>
                      {s.label}
                      <Show when={s.count() > 0}><span class="muted"> {s.count()}</span></Show>
                      <Show when={s.id === "body" && props.tab.draft.body.type !== "none"}>
                        <span class="muted"> {props.tab.draft.body.type}</span>
                      </Show>
                      <Show when={(s.id === "settings" && overrides().settings) || (s.id === "auth" && overrides().auth)}>
                        <span class="section-dot" title={s.id === "auth" ? "This request sets its own auth" : "This request overrides a default"} />
                      </Show>
                    </button>
                  )}
                </For>
                <span class="row-spacer" />
                <SaveIndicator state={props.tab.save} error={props.tab.saveError}
                  onRetry={() => void props.controller.retrySave(id())} />
              </div>
              <div class="section-content">
                <Switch>
                  <Match when={props.tab.section === "params"}>
                    <KeyValueEditor kind="params" rows={props.tab.draft.query_params}
                      onChange={(rows) => edit((d) => (d.query_params = rows))} />
                  </Match>
                  <Match when={props.tab.section === "headers"}>
                    <KeyValueEditor kind="headers" rows={props.tab.draft.headers} keyPlaceholder="Header"
                      onChange={(rows) => edit((d) => (d.headers = rows))} />
                  </Match>
                  <Match when={props.tab.section === "body"}>
                    <BodyEditor body={props.tab.draft.body} onChange={(fn) => edit((d) => fn(d.body))} />
                  </Match>
                  <Match when={props.tab.section === "auth"}>
                    <AuthEditor auth={props.tab.draft.auth} idPrefix={`req-${props.tab.id}`} noun="request"
                      options={modeOptions(currentTree(), props.tab.id)}
                      effective={effectiveAuthOf(currentTree(), props.tab.id, props.tab.draft.auth)}
                      onChange={(next) => edit((d) => (d.auth = next))} />
                  </Match>
                  <Match when={props.tab.section === "settings"}>
                    <RequestSettingsPanel requestId={props.tab.id} />
                  </Match>
                  <Match when={props.tab.section === "history"}>
                    <RequestHistoryPanel requestId={props.tab.id} requestName={props.tab.name}
                      onOpenHistory={() => props.controller.openHistory()} />
                  </Match>
                </Switch>
              </div>
            </div>
            <div class="split-divider" role="separator" aria-orientation="horizontal" aria-label="Resize response"
              onPointerDown={startDrag} />
            <div class="editor-response" style={{ flex: `${props.tab.responseShare} 1 0` }}>
              <ResponseView tab={props.tab} onView={view} />
            </div>
          </div>
        </div>
      </Match>
    </Switch>
  );
}
