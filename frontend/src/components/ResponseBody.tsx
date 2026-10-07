import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import type { Range } from "../jsonFold";
import { bodyMenu } from "../responseView";
import {
  counterText, findMatches, firstAtOrAfter, Match, MAX_MATCHES, stepIndex, visibleMatches,
} from "../responseSearch";
import type { ResponseViewerHandle } from "../responseViewer";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import Icon from "./Icon";

export interface ResponseBodyApi {
  openSearch: (prefill?: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
}

interface Props {
  text: string; // the body as displayed (pretty text in Pretty, raw string in Raw)
  structured: boolean; // collapsible JSON (Pretty view of valid JSON)
  fallbackNotice: boolean; // Pretty of a truncated JSON body: flat text + notice
  wrap: boolean;
  folds?: Range[]; // this tab's collapse state for this response (restored on remount)
  onFolds: (folds: Range[]) => void;
  ref: (api: ResponseBodyApi) => void;
}

// Pretty / Raw body: a read-only CodeMirror viewer (responseViewer.ts) with a
// search bar docked above it (the body scrolls under it, nothing is covered) and
// a right-click menu (Copy / Copy All / Search in response).
export default function ResponseBody(props: Props) {
  let host!: HTMLDivElement;
  let input: HTMLInputElement | undefined;
  let viewer: ResponseViewerHandle | undefined;
  const [ready, setReady] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [all, setAll] = createSignal<Match[]>([]);
  const [visible, setVisible] = createSignal<Match[]>([]);
  const [current, setCurrent] = createSignal(-1);
  const [menu, setMenu] = createSignal<{ x: number; y: number; selection: string }>();

  const paint = () => viewer?.setSearch(visible(), current());

  // Matches hidden in collapsed nodes are not navigable; keep the current match
  // when it is still visible.
  const refreshVisible = (keepFrom?: number) => {
    const vis = visibleMatches(all(), viewer?.folds() ?? []);
    setVisible(vis);
    const at = keepFrom === undefined ? -1 : vis.findIndex((m) => m.from === keepFrom);
    setCurrent(at >= 0 ? at : vis.length ? firstAtOrAfter(vis, keepFrom ?? 0) : -1);
    paint();
  };

  const runSearch = () => {
    setAll(searchOpen() ? findMatches(props.text, query(), caseSensitive()) : []);
    refreshVisible();
    const m = visible()[current()];
    if (m) viewer?.reveal(m);
  };

  const jump = (dir: 1 | -1) => {
    const next = stepIndex(current(), visible().length, dir);
    setCurrent(next);
    paint();
    const m = visible()[next];
    if (m) viewer?.reveal(m);
  };

  const openSearch = (prefill?: string) => {
    if (prefill !== undefined && prefill !== "" && !prefill.includes("\n")) setQuery(prefill);
    setSearchOpen(true);
    queueMicrotask(() => {
      input?.focus();
      input?.select();
    });
    runSearch();
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setAll([]);
    setVisible([]);
    setCurrent(-1);
    viewer?.setSearch([], -1);
    viewer?.focus();
  };

  onMount(async () => {
    const { createResponseViewer } = await import("../responseViewer");
    if (!host.isConnected) return;
    viewer = createResponseViewer(host, {
      onFind: () => openSearch(viewer?.selection()),
      onFoldsChanged: () => {
        props.onFolds(viewer!.folds());
        refreshVisible(visible()[current()]?.from);
      },
      onContextMenu: (e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, selection: viewer?.selection() ?? "" });
      },
    });
    viewer.setWrap(props.wrap);
    setReady(true);
  });
  onCleanup(() => viewer?.destroy());

  // New text (new response, or Pretty <-> Raw): reload; the search re-runs on it.
  createEffect(on(() => [ready(), props.text, props.structured] as const, ([isReady]) => {
    if (!isReady || !viewer) return;
    viewer.setContent(props.text, props.structured, props.folds);
    runSearch();
  }));
  createEffect(on(() => props.wrap, (w) => ready() && viewer?.setWrap(w), { defer: true }));
  createEffect(on([query, caseSensitive], () => ready() && searchOpen() && runSearch(), { defer: true }));

  props.ref({
    openSearch,
    collapseAll: () => viewer?.collapseAll(),
    expandAll: () => viewer?.expandAll(),
  });

  const menuItems = (selection: string): MenuEntry[] =>
    bodyMenu({ hasSelection: selection !== "" }).map((item) => ({
      label: item.label,
      disabled: !item.enabled,
      icon: item.action === "search" ? ("search" as const) : undefined,
      hint: item.action === "search" ? "Ctrl+F" : undefined,
      onSelect: () => {
        if (item.action === "copy") void ClipboardSetText(selection);
        else if (item.action === "copyAll") void ClipboardSetText(props.text);
        else openSearch(selection);
      },
    }));

  return (
    <div class="response-body-pane">
      <Show when={props.fallbackNotice}>
        <p class="notice">Structure view unavailable (truncated response) — showing the text as received.</p>
      </Show>
      <Show when={searchOpen()}>
        <div class="response-search" role="search">
          <Icon name="search" size={14} />
          <input ref={input} type="text" class="response-search-input" placeholder="Search in response"
            aria-label="Search in response" spellcheck={false} value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jump(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
              }
            }} />
          <span class="response-search-count" aria-live="polite">
            {query() ? counterText(current(), visible().length, all().length >= MAX_MATCHES) : ""}
          </span>
          <button type="button" classList={{ "response-search-btn": true, active: caseSensitive() }}
            aria-pressed={caseSensitive()} title="Match case" onClick={() => setCaseSensitive((v) => !v)}>Aa</button>
          <button type="button" class="response-search-btn" title="Previous (Shift+Enter)" aria-label="Previous match"
            disabled={visible().length === 0} onClick={() => jump(-1)}>▲</button>
          <button type="button" class="response-search-btn" title="Next (Enter)" aria-label="Next match"
            disabled={visible().length === 0} onClick={() => jump(1)}>▼</button>
          <button type="button" class="response-search-btn" title="Close (Escape)" aria-label="Close search"
            onClick={closeSearch}><Icon name="close" size={14} /></button>
        </div>
      </Show>
      {/* The CodeMirror host has no Solid-managed children. */}
      <div class="response-viewer" ref={host}
        onKeyDown={(e) => e.key === "Escape" && searchOpen() && (e.preventDefault(), closeSearch())} />
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} label="Response body" items={menuItems(m().selection)} onClose={() => setMenu(undefined)} />}
      </Show>
    </div>
  );
}
