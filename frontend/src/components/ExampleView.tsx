import { createSignal, For, Match, Show, Switch } from "solid-js";
import { main } from "../../wailsjs/go/models";
import { formatBytes } from "../historyModel";
import {
  BODY_VIEWS, BodyView, bodyText, effectiveView, hasStructure, prettyFallback, previewFrameAttrs, ResponseLike,
  toolbarControls, viewAvailability,
} from "../responseView";
import { responseWrap, setResponseWrap } from "../uiPrefs";
import HistoryKVTable from "./HistoryKVTable";
import Icon from "./Icon";
import MediaPreview from "./MediaPreview";
import ResponseBody, { ResponseBodyApi } from "./ResponseBody";

interface Props {
  detail: main.ExampleDetail;
  onSave: () => void; // the body to a file (any type)
}

const NO_BODY = { enabled: false, title: "This example has no body" };

// An example in VIEW mode: the response pane's viewer and toolbar rules
// (responseView.ts) over Go's preview of the stored example — Pretty JSON with
// folding + search, Raw, Preview for HTML (sandboxed iframe) and image / audio /
// video (streamed from /example-media/{id}); pdf / binary → a file card with
// Save. Controls that do not apply are disabled, never hidden.
export default function ExampleView(props: Props) {
  const [part, setPart] = createSignal<"body" | "headers">("body");
  const [chosen, setChosen] = createSignal<BodyView>();
  let body: ResponseBodyApi | undefined;

  const d = () => props.detail;
  const hasBody = () => d().body_size > 0;
  const like = (): ResponseLike => ({
    contentType: d().content_type, formatted: d().formatted, body: d().body, rawBody: d().raw_body,
    truncated: d().preview_cut, media: d().media || undefined, mediaUrl: d().media_url || undefined,
  });
  const view = () => effectiveView(like(), chosen());
  const views = () => viewAvailability(like());
  const controls = () => {
    const c = toolbarControls({ hasResponse: true, section: part(), view: view(), structured: hasStructure(like()) });
    return hasBody() ? c : { ...c, views: NO_BODY, wrap: NO_BODY, search: NO_BODY, fold: NO_BODY, save: NO_BODY };
  };

  return (
    <div class="example-view">
      <div class="response-toolbar">
        <div class="segmented small" role="tablist" aria-label="Example part">
          <button type="button" role="tab" aria-selected={part() === "body"} classList={{ active: part() === "body" }}
            onClick={() => setPart("body")}>Body</button>
          <button type="button" role="tab" aria-selected={part() === "headers"} classList={{ active: part() === "headers" }}
            onClick={() => setPart("headers")}>Headers <span class="muted resp-count">{d().headers.length}</span></button>
        </div>
        <span class="row-spacer" />
        <span class="toolbar-slot" title={controls().views.title}>
          <div class="segmented small" role="radiogroup" aria-label="Body view">
            <For each={BODY_VIEWS}>
              {(v) => (
                <button type="button" role="radio" aria-checked={view() === v.id}
                  classList={{ active: hasBody() && view() === v.id }}
                  title={controls().views.enabled ? views()[v.id].title : undefined}
                  disabled={!controls().views.enabled || !views()[v.id].enabled}
                  onClick={() => setChosen(v.id)}>{v.label}</button>
              )}
            </For>
          </div>
        </span>
        <label classList={{ "choice small toolbar-slot": true, disabled: !controls().wrap.enabled }} title={controls().wrap.title}>
          <input type="checkbox" checked={responseWrap()} disabled={!controls().wrap.enabled}
            onChange={(e) => setResponseWrap(e.currentTarget.checked)} />
          Wrap
        </label>
        <div class="toolbar-icons" role="group" aria-label="Example actions">
          <span class="toolbar-slot" title={controls().search.title}>
            <button type="button" class="toolbar-icon" aria-label="Search in example" disabled={!controls().search.enabled}
              onClick={() => body?.openSearch()}><Icon name="search" /></button>
          </span>
          <span class="toolbar-slot" title={controls().fold.enabled ? "Collapse all (to depth 1)" : controls().fold.title}>
            <button type="button" class="toolbar-icon" aria-label="Collapse all" disabled={!controls().fold.enabled}
              onClick={() => body?.collapseAll()}><Icon name="collapse" /></button>
          </span>
          <span class="toolbar-slot" title={controls().fold.enabled ? "Expand all" : controls().fold.title}>
            <button type="button" class="toolbar-icon" aria-label="Expand all" disabled={!controls().fold.enabled}
              onClick={() => body?.expandAll()}><Icon name="expand" /></button>
          </span>
          <span class="toolbar-slot" title={hasBody() ? "Save the example body to a file" : NO_BODY.title}>
            <button type="button" class="toolbar-icon" aria-label="Save example body to file" disabled={!hasBody()}
              onClick={() => props.onSave()}><Icon name="download" /></button>
          </span>
        </div>
        <div class="resp-indicators">
          <span class="toolbar-divider" aria-hidden="true" />
          <span class="resp-metric" title="Content-Type">{d().content_type || "no Content-Type"}</span>
          <span class="resp-metric" title="Body size">{formatBytes(d().body_size)}</span>
        </div>
      </div>
      <div class="response-content">
        <Switch>
          <Match when={part() === "headers"}>
            <Show when={d().headers.length > 0} fallback={<p class="placeholder small">No headers</p>}>
              <HistoryKVTable rows={d().headers.map((h) => ({ key: h.key, value: h.value, off: !h.enabled }))} />
            </Show>
          </Match>
          <Match when={!hasBody()}>
            <p class="placeholder response-empty">This example has no body.</p>
          </Match>
          <Match when={view() === "preview" && d().media}>
            <div class="response-media">
              <MediaPreview media={d().media} url={d().media_url} contentType={d().content_type} bytes={d().body_size}
                onSave={() => props.onSave()} />
            </div>
          </Match>
          <Match when={view() === "preview"}>
            <iframe class="response-preview" {...previewFrameAttrs(d().body)} />
          </Match>
          <Match when={true}>
            <Show when={d().preview_cut}>
              <p class="notice">Showing the first 256 KB of {formatBytes(d().body_size)}.</p>
            </Show>
            <ResponseBody text={bodyText(like(), view())} structured={view() === "pretty" && hasStructure(like())}
              fallbackNotice={view() === "pretty" && prettyFallback(like())} wrap={responseWrap()}
              onFolds={() => undefined} ref={(api) => (body = api)} />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
