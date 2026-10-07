import { createSignal, Match, Show, Switch } from "solid-js";
import { main } from "../../wailsjs/go/models";
import { bodyDisplay, formatBytes, mediaLabel } from "../historyModel";

interface Props {
  response: main.HistoryResponse;
  onSave: () => void;
}

// A stored media / binary response: images, audio and video load from the
// app-local /history-media/{id} route (Go streams the stored bytes; nothing
// crosses the Wails bridge); PDFs and other binary data are offered as a file.
export default function HistoryMedia(props: Props) {
  const [broken, setBroken] = createSignal(false);
  const label = () => mediaLabel(props.response.media, props.response.content_type);
  const size = () => formatBytes(props.response.stored_bytes);

  return (
    <div class="history-media">
      <Show when={props.response.stored_truncated}>
        <p class="settings-hint">
          History kept the first {formatBytes(props.response.stored_bytes)} of {formatBytes(props.response.body_size)}
          {" "}(Settings → History), so this may be incomplete.
        </p>
      </Show>
      <Switch>
        <Match when={bodyDisplay(props.response) === "image" && !broken()}>
          <div class="history-media-stage">
            <img src={props.response.media_url} alt={label()} onError={() => setBroken(true)} />
          </div>
        </Match>
        <Match when={bodyDisplay(props.response) === "audio"}>
          <audio class="history-media-audio" controls preload="metadata" src={props.response.media_url} />
        </Match>
        <Match when={bodyDisplay(props.response) === "video"}>
          <div class="history-media-stage">
            <video controls preload="metadata" src={props.response.media_url} />
          </div>
        </Match>
      </Switch>
      <div class="history-media-file">
        <span><strong>{label()}</strong> <span class="muted">· {size()}</span></span>
        <Show when={broken()}><span class="muted small">The image could not be displayed.</span></Show>
        <span class="row-spacer" />
        <button type="button" class="small" onClick={() => props.onSave()}>Save to file…</button>
      </div>
    </div>
  );
}
