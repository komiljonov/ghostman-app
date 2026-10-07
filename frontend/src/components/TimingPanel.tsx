import { For, Show } from "solid-js";
import { HopLike, timingModel } from "../timingModel";

interface Props {
  hops: HopLike[];
}

// The detail behind the toolbar's duration: one section per hop with a stacked
// phase bar (DNS · connect · wait · download, theme token colors) and a phase
// table; reused connections show "reused" for DNS/connect and leave those
// segments out; a failed hop is marked red with the phase it died in. A single
// hop renders as one plain section (no numbering), the footer sums the chain.
export default function TimingPanel(props: Props) {
  const model = () => timingModel(props.hops);
  return (
    <Show when={model()}>
      {(m) => (
        <div class="timing-panel" aria-label="Request timing">
          <For each={m().sections}>
            {(s) => (
              <section classList={{ "timing-hop": true, failed: s.failed }}>
                <header class="timing-hop-head">
                  <Show when={s.badge}><span class="timing-badge">{s.badge}</span></Show>
                  <span classList={{ "timing-status": true, failed: s.failed }}>{s.status}</span>
                  <span class="timing-url" title={`${s.method} ${s.url}`}>{s.method} {s.url}</span>
                  <span class="timing-total">{s.total}</span>
                </header>
                <div class="timing-bar" aria-hidden="true">
                  <For each={s.segments}>
                    {(seg) => <span class={`timing-seg phase-${seg.phase}`} style={{ width: `${seg.pct}%` }} />}
                  </For>
                </div>
                <table class="timing-table">
                  <tbody>
                    <For each={s.rows}>
                      {(r) => (
                        <tr classList={{ [`kind-${r.kind}`]: true }}>
                          <td><span class={`timing-dot phase-${r.phase}`} />{r.label}</td>
                          <td class="timing-value">{r.value}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
                <Show when={s.failure}>
                  <p class="timing-failure" role="alert">{s.failure}</p>
                </Show>
              </section>
            )}
          </For>
          <footer class="timing-footer">{m().footer}</footer>
        </div>
      )}
    </Show>
  );
}
