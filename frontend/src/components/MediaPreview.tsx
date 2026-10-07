import { createSignal, Match, Show, Switch } from "solid-js";
import { bodyDisplay, formatBytes, mediaLabel } from "../historyModel";

interface Props {
  media: string; // image | audio | video | pdf | binary
  url: string; // app-local route streaming the bytes ("" = not displayable)
  contentType: string;
  bytes: number;
  note?: string; // e.g. "history kept only the first part"
  onSave: () => void;
}

// A media / binary response body, in the live response pane (Preview) and in a
// history entry. Images, audio and video load from an app-local route (Go
// streams the bytes it holds; nothing crosses the Wails bridge); PDFs and other
// binary data get a file card with Save.
export default function MediaPreview(props: Props) {
  const [broken, setBroken] = createSignal(false);
  const label = () => mediaLabel(props.media, props.contentType);
  const display = () => bodyDisplay(props.media, props.url);

  return (
    <div class="media-preview">
      <Show when={props.note}><p class="settings-hint">{props.note}</p></Show>
      <Switch>
        <Match when={display() === "image" && !broken()}>
          <div class="media-preview-stage">
            <img src={props.url} alt={label()} onError={() => setBroken(true)} />
          </div>
        </Match>
        <Match when={display() === "audio"}>
          <audio class="media-preview-audio" controls preload="metadata" src={props.url} />
        </Match>
        <Match when={display() === "video"}>
          <div class="media-preview-stage">
            <video controls preload="metadata" src={props.url} />
          </div>
        </Match>
      </Switch>
      <div class="media-preview-file">
        <span><strong>{label()}</strong> <span class="muted">· {formatBytes(props.bytes)}</span></span>
        <Show when={broken()}><span class="muted small">The image could not be displayed.</span></Show>
        <span class="row-spacer" />
        <button type="button" class="small" onClick={() => props.onSave()}>Save to file…</button>
      </div>
    </div>
  );
}
