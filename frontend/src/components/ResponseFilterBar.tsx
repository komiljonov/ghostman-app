import { For, onCleanup } from "solid-js";
import {
  afterEval, Availability, createFilterRunner, FILTER_DOCS, FILTER_EXAMPLES, FILTER_PLACEHOLDER, filterDisplay, FilterResultLike,
  FilterState, NO_FILTER,
} from "../responseFilter";
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime";
import Dropdown from "./Dropdown";
import Icon from "./Icon";

interface Props {
  query: string;
  onQuery: (query: string) => void; // live: the request's response_filter (autosaved); history: local
  state: FilterState;
  onState: (state: FilterState) => void;
  evaluate: (query: string) => Promise<FilterResultLike>; // Go: EvalResponseFilter / EvalHistoryFilter
  availability: Availability;
  onCopy: () => void; // copies the whole result, Go-side
  onWarm?: () => void; // the input got focus: Go starts parsing the body in the background
}

// The jq filter bar under the response toolbar (live response pane and history
// detail). Its row is always present; it is disabled (with the reason) for
// anything but JSON. Typing evaluates 300 ms after the last keystroke (Enter at
// once); an error mid-typing is a quiet hint and the last good result stays.
// ✕ shows the full body again at once (no evaluation) and keeps the query —
// editing it or Enter turns the result view back on.
export default function ResponseFilterBar(props: Props) {
  const runner = createFilterRunner(
    (q) => props.evaluate(q),
    (_q, r) => props.onState(afterEval(props.state, r)),
  );
  onCleanup(() => runner.cancel());

  const display = () => filterDisplay(props.state);
  const enabled = () => props.availability.enabled;
  const hint = () => {
    if (!enabled()) return "";
    if (props.state.error) return props.state.error;
    const d = display();
    if (d.mode !== "full") return d.note;
    return props.query.trim() ? "Showing the full response — press Enter to apply the filter" : "";
  };

  const change = (q: string) => {
    props.onQuery(q);
    if (q.trim() === "") {
      runner.cancel();
      props.onState(NO_FILTER);
    } else runner.schedule(q);
  };
  const applyNow = (q: string) => {
    if (q.trim() !== "") void runner.now(q);
  };

  return (
    <div class="filter-bar-wrap">
      <div classList={{ "filter-bar": true, disabled: !enabled(), active: display().mode !== "full" }}
        title={enabled() ? undefined : props.availability.title}>
        <span class="filter-bar-label" aria-hidden="true">jq</span>
        <input type="text" class="filter-bar-input" spellcheck={false} autocomplete="off"
          aria-label="Response filter (jq)" placeholder={FILTER_PLACEHOLDER}
          value={props.query} disabled={!enabled()}
          onFocus={() => props.onWarm?.()}
          onInput={(e) => change(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyNow(e.currentTarget.value);
            } else if (e.key === "Escape" && display().mode !== "full") {
              e.preventDefault();
              e.stopPropagation();
              props.onState({ ...props.state, active: false });
            }
          }} />
        <Dropdown triggerLabel="Filter examples" triggerClass="filter-bar-btn" align="right" menuRole="dialog"
          menuClass="filter-help" disabled={!enabled()} trigger={<span aria-hidden="true">?</span>}>
          {(close) => (
            <div class="filter-help-body">
              <div class="filter-help-head">
                <p class="filter-help-title">jq examples <span class="muted">— click to use</span></p>
                <button type="button" class="filter-help-learn" title={FILTER_DOCS[0].url}
                  onClick={() => { close(); BrowserOpenURL(FILTER_DOCS[0].url); }}>
                  Learn jq <Icon name="external" size={12} />
                </button>
              </div>
              <For each={FILTER_EXAMPLES}>
                {(ex) => (
                  <button type="button" class="filter-help-item" onClick={() => {
                    close();
                    props.onQuery(ex.query);
                    applyNow(ex.query);
                  }}>
                    <code>{ex.query}</code>
                    <span class="muted">{ex.what}</span>
                  </button>
                )}
              </For>
              {/* Learn the query language: the official docs, in the system browser. */}
              <div class="filter-help-docs">
                <For each={FILTER_DOCS}>
                  {(d) => (
                    <button type="button" class="filter-help-doc" title={d.url}
                      onClick={() => { close(); BrowserOpenURL(d.url); }}>
                      <span class="filter-help-doc-label">{d.label} <Icon name="external" size={12} /></span>
                      <span class="muted">{d.what}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </Dropdown>
        <button type="button" class="filter-bar-btn" aria-label="Copy filtered result"
          title={display().mode === "result" ? "Copy the filtered result" : "Nothing filtered to copy"}
          disabled={!enabled() || display().mode !== "result"} onClick={() => props.onCopy()}>
          <Icon name="duplicate" size={14} />
        </button>
        <button type="button" class="filter-bar-btn" aria-label="Show the full response"
          title={display().mode !== "full" ? "Show the full response (Esc)" : "No filter applied"}
          disabled={!enabled() || display().mode === "full"}
          onClick={() => props.onState({ ...props.state, active: false })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {/* Always one line tall (stable layout): the note, a quiet error, or nothing. */}
      <p classList={{ "filter-bar-hint": true, "muted small": true, "filter-bar-hint-error": !!props.state.error }} role="status">{hint()}</p>
    </div>
  );
}
