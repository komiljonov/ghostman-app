import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import {
  DeleteExample, GetExampleDetail, ListExamples, MoveExample, RenameExample, SaveExampleBodyToFile,
} from "../../wailsjs/go/main/App";
import { api, main } from "../../wailsjs/go/models";
import { SaveState } from "../autosave";
import { handleProblem } from "../authStore";
import { exampleMeta, moveState } from "../examplesModel";
import { examplesTick, setExampleList } from "../examplesStore";
import ConfirmDialog from "./ConfirmDialog";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import ExampleEditor from "./ExampleEditor";
import ExampleView from "./ExampleView";
import FormError from "./FormError";
import Icon from "./Icon";
import SaveIndicator from "./SaveIndicator";
import StatusBadge from "./StatusBadge";

interface Props {
  requestId: string;
  openId: string | undefined; // the example shown in detail (kept per tab)
  mode: "view" | "edit";
  onOpen: (id: string | undefined, mode?: "view" | "edit") => void;
}

// The request editor's Examples sub-tab: the request's saved response examples
// (server, shared with the team) as a list — name · status · type · size ·
// updated, ↑ / ↓, a row menu (Open, Rename inline, Delete) — or one example's
// detail in View (the response viewer) or Edit (autosaved form) mode. Every
// mutation re-fetches; the list also re-fetches on mount, on window focus and
// after a save elsewhere (examplesTick), so teammates' edits show up.
export default function ExamplesPanel(props: Props) {
  const [list, setList] = createSignal<api.ExampleSummary[]>();
  const [error, setError] = createSignal<string>();
  const [renaming, setRenaming] = createSignal<string>();
  const [renameDraft, setRenameDraft] = createSignal("");
  const [menu, setMenu] = createSignal<{ e: api.ExampleSummary; x: number; y: number }>();
  const [deleting, setDeleting] = createSignal<api.ExampleSummary>();
  const [detail, setDetail] = createSignal<main.ExampleDetail>();
  const [detailError, setDetailError] = createSignal<string>();
  const [saveState, setSaveState] = createSignal<SaveState>("idle");
  const [saveError, setSaveError] = createSignal<string>();
  const [toast, setToastRaw] = createSignal<string>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const setToast = (t: string | undefined) => {
    clearTimeout(toastTimer);
    setToastRaw(t);
    if (t) toastTimer = setTimeout(() => setToastRaw(undefined), 8000);
  };
  onCleanup(() => clearTimeout(toastTimer));
  let saver: { flush: () => Promise<void>; retry: () => Promise<void> } | undefined;
  const now = () => Date.now();

  const reload = async () => {
    const id = props.requestId;
    const r = await ListExamples(id);
    handleProblem(r.error);
    if (id !== props.requestId) return;
    setError(r.error?.message);
    if (r.data) {
      setList(r.data);
      setExampleList(id, r.data); // the badge and the tree's rows
      // Deleted elsewhere (the tree, a teammate): leave its detail.
      if (props.openId && !r.data.some((e) => e.id === props.openId)) props.onOpen(undefined);
    }
  };
  const loadDetail = async (id: string) => {
    setDetailError(undefined);
    const r = await GetExampleDetail(id);
    handleProblem(r.error);
    if (props.openId !== id) return;
    if (r.data) setDetail(r.data);
    else {
      setDetail(undefined);
      setDetailError(r.error?.status === 404 ? "This example no longer exists." : r.error?.message);
      if (r.error?.status === 404) void reload();
    }
  };

  onMount(() => {
    const onFocus = () => {
      void reload();
      if (props.openId && props.mode === "view") void loadDetail(props.openId);
    };
    window.addEventListener("focus", onFocus);
    onCleanup(() => window.removeEventListener("focus", onFocus));
  });
  createEffect(on([() => props.requestId, examplesTick], () => void reload()));
  // Renamed elsewhere (the tree): the open View re-reads it.
  createEffect(on(examplesTick, () => {
    if (props.openId && props.mode === "view") void loadDetail(props.openId);
  }, { defer: true }));
  // Opening an example, or switching back to View, fetches it fresh (edits included).
  createEffect(on([() => props.openId, () => props.mode], ([id, mode]) => {
    setDetail(undefined);
    setSaveState("idle");
    if (id && mode) void loadDetail(id); // the Edit form starts from the server state too
  }));

  const leaveDetail = async (next: () => void) => {
    await saver?.flush();
    saver = undefined;
    next();
  };

  const submitRename = async (e: api.ExampleSummary) => {
    const name = renameDraft().trim();
    setRenaming(undefined);
    if (name === "" || name === e.name) return;
    const r = await RenameExample(e.id, name);
    handleProblem(r.error);
    setError(r.error?.message);
    await reload();
  };
  const move = async (e: api.ExampleSummary, delta: number) => {
    const r = await MoveExample(props.requestId, e.id, delta);
    handleProblem(r.error);
    setError(r.error?.message);
    await reload();
  };
  const saveBody = async (id: string) => {
    const r = await SaveExampleBodyToFile(id);
    handleProblem(r.error);
    if (r.error) return setToast(r.error.message);
    if (r.data) setToast(`Saved ${r.data.bytes_written.toLocaleString("en-US")} bytes to ${r.data.path}`);
  };

  const menuItems = (e: api.ExampleSummary): MenuEntry[] => [
    { label: "Open", onSelect: () => props.onOpen(e.id, "view") },
    { label: "Edit", icon: "pencil", onSelect: () => props.onOpen(e.id, "edit") },
    { label: "Rename", onSelect: () => {
      setRenameDraft(e.name);
      setRenaming(e.id);
    } },
    "separator",
    { label: "Delete", icon: "trash", danger: true, onSelect: () => setDeleting(e) },
  ];

  return (
    <div class="examples-panel">
      <Show when={props.openId} fallback={
        <>
          <FormError message={error()} />
          <Show when={list()} fallback={<p class="placeholder small">Loading examples…</p>}>
            {(l) => (
              <Show when={l().length > 0} fallback={
                <p class="placeholder small examples-empty">
                  No examples yet. Send the request, then <Icon name="bookmark" size={14} /> <strong>Save as example</strong> in the
                  response toolbar (or from a History entry).
                </p>
              }>
                <ul class="examples-list" aria-label="Examples">
                  <For each={l()}>
                    {(e, i) => {
                      const m = () => exampleMeta(e, now());
                      const mv = () => moveState(i(), l().length);
                      return (
                        <li class="examples-row" onClick={() => renaming() !== e.id && props.onOpen(e.id, "view")}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            setMenu({ e, x: ev.clientX, y: ev.clientY });
                          }}>
                          <StatusBadge status={e.status} />
                          <Show when={renaming() === e.id} fallback={<span class="examples-name" title={e.name}>{e.name}</span>}>
                            <input class="tree-rename" aria-label="New name" value={renameDraft()} maxLength={100}
                              ref={(el) => queueMicrotask(() => {
                                el.focus();
                                el.select();
                              })}
                              onClick={(ev) => ev.stopPropagation()}
                              onInput={(ev) => setRenameDraft(ev.currentTarget.value)}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") void submitRename(e);
                                if (ev.key === "Escape") setRenaming(undefined);
                              }}
                              onBlur={() => void submitRename(e)} />
                          </Show>
                          <span class="examples-meta muted small" title={e.content_type}>{m().contentType}</span>
                          <span class="examples-meta muted small">{m().size}</span>
                          <span class="examples-meta muted small" title={new Date(e.updated_at).toLocaleString()}>{m().updated}</span>
                          <span class="examples-move" onClick={(ev) => ev.stopPropagation()}>
                            <button type="button" class="icon-button small-move" aria-label={`Move ${e.name} up`} title="Move up"
                              disabled={!mv().up} onClick={() => void move(e, -1)}>↑</button>
                            <button type="button" class="icon-button small-move" aria-label={`Move ${e.name} down`} title="Move down"
                              disabled={!mv().down} onClick={() => void move(e, 1)}>↓</button>
                          </span>
                          <button type="button" class="row-menu-trigger" aria-label={`Actions for ${e.name}`} aria-haspopup="menu"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              const r = ev.currentTarget.getBoundingClientRect();
                              setMenu({ e, x: ev.detail === 0 ? r.left : ev.clientX, y: ev.detail === 0 ? r.bottom : ev.clientY });
                            }}>
                            <Icon name="dots" />
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        </>
      }>
        {(openId) => (
          <div class="example-detail">
            <header class="example-detail-head">
              <button type="button" class="link-button" onClick={() => void leaveDetail(() => props.onOpen(undefined))}>
                ← Examples
              </button>
              <Show when={detail()}>
                {(dd) => (
                  <>
                    <StatusBadge status={dd().status} />
                    <span class="example-detail-name" title={dd().name}>{dd().name}</span>
                  </>
                )}
              </Show>
              <span class="row-spacer" />
              <Show when={props.mode === "edit"}>
                <SaveIndicator state={saveState()} error={saveError()} onRetry={() => void saver?.retry()} />
              </Show>
              <div class="segmented small" role="radiogroup" aria-label="Example mode">
                <button type="button" role="radio" aria-checked={props.mode === "view"} classList={{ active: props.mode === "view" }}
                  onClick={() => props.mode !== "view" && void leaveDetail(() => props.onOpen(openId(), "view"))}>View</button>
                <button type="button" role="radio" aria-checked={props.mode === "edit"} classList={{ active: props.mode === "edit" }}
                  onClick={() => props.onOpen(openId(), "edit")}>Edit</button>
              </div>
            </header>
            <FormError message={detailError()} />
            <Show when={detail()} keyed fallback={<Show when={!detailError()}><p class="placeholder small">Loading example…</p></Show>}>
              {(dd) => (
                <Show when={props.mode === "edit"} fallback={<ExampleView detail={dd} onSave={() => void saveBody(dd.id)} />}>
                  <ExampleEditor detail={dd} onSaved={() => void reload()} onSaver={(s) => (saver = s)}
                    onState={(s, e) => {
                      setSaveState(s);
                      setSaveError(s === "error" ? e : undefined);
                    }} />
                </Show>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={toast()}>
        {(t) => (
          <div class="response-toast" role="status">
            <span>{t()}</span>
            <button type="button" class="response-toast-close" aria-label="Dismiss" onClick={() => setToast(undefined)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </Show>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} label="Example actions" items={menuItems(m().e)} onClose={() => setMenu(undefined)} />}
      </Show>
      <Show when={deleting()}>
        {(e) => (
          <ConfirmDialog title="Delete example"
            message={`Delete the example “${e().name}” for everyone on the project?`}
            confirmLabel="Delete example"
            action={() => DeleteExample(e().id)}
            onDone={() => {
              if (props.openId === e().id) props.onOpen(undefined);
              void reload();
            }}
            onClose={() => setDeleting(undefined)} />
        )}
      </Show>
    </div>
  );
}
