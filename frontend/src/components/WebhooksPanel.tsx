import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { CreateWebhook, DeleteWebhook, GetWebhookPanel, SetWebhookPanel, UpdateWebhook } from "../../wailsjs/go/main/App";
import { api, main } from "../../wailsjs/go/models";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { handleProblem } from "../authStore";
import { createAction } from "../action";
import {
  clampPanel, effectiveDomain, hookUrls, isNotConfigured, NOT_CONFIGURED_TEXT, PANEL_DEFAULT_FRACTION, panelFraction, panelHeight,
} from "../webhookModel";
import {
  feedOf, hookDomains, hookMetaLoaded, listenState, loadWebhooks, reloadWebhooks, webhooks, webhooksError, webhooksLoaded,
} from "../webhookStore";
import ConfirmDialog from "./ConfirmDialog";
import ContextMenu, { MenuEntry } from "./ContextMenu";
import FormError from "./FormError";
import Icon from "./Icon";

interface Props {
  projectId: string;
  refreshTick: number;
  onOpen: (id: string, name: string) => void;
  // A webhook tab is open (and therefore polled) for this endpoint.
  isOpen: (id: string) => boolean;
}

// The "Webhooks" panel docked at the bottom of the sidebar: one bar (chevron,
// title, endpoint count, "+") that expands upward into the endpoint list; the
// tree above shrinks and keeps its own scroll. Expanded state and height are
// per project (GetWebhookPanel / SetWebhookPanel); the height is a fraction of
// the sidebar, clamped so the panel keeps 120 px and the tree 160 px
// (webhookModel.panelHeight). Dragging the top edge rewrites only this element's
// height (no re-render) and saves once on release; double-click resets to 30 %.
export default function WebhooksPanel(props: Props) {
  const [expanded, setExpanded] = createSignal(false);
  const [fraction, setFraction] = createSignal(PANEL_DEFAULT_FRACTION);
  const [total, setTotal] = createSignal(0); // the sidebar's height
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [notConfigured, setNotConfigured] = createSignal(false);
  const [renamingId, setRenamingId] = createSignal<string>();
  const [renameDraft, setRenameDraft] = createSignal("");
  const [rowError, setRowError] = createSignal<string>();
  const [deleting, setDeleting] = createSignal<api.Webhook>();
  const [menu, setMenu] = createSignal<{ hook: api.Webhook; x: number; y: number }>();
  const [copied, setCopied] = createSignal<string>();
  let panelEl!: HTMLElement;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));

  const off = () => hookMetaLoaded() && hookDomains().length === 0;
  const height = () => panelHeight(fraction(), total());

  // Per project: restore the panel state, then load its endpoints.
  const projectId = createMemo(() => props.projectId);
  createEffect(on(projectId, async (id) => {
    setCreating(false);
    setRenamingId(undefined);
    setRowError(undefined);
    setNotConfigured(false);
    const prefs = await GetWebhookPanel(id);
    if (id !== props.projectId) return;
    setExpanded(prefs.expanded);
    setFraction(prefs.fraction);
    await loadWebhooks(id);
  }));
  createEffect(on(() => props.refreshTick, () => void reloadWebhooks(), { defer: true }));

  // The sidebar's height decides the clamp; observed, never polled.
  onMount(() => {
    const stack = panelEl.parentElement!;
    const ro = new ResizeObserver(() => setTotal(stack.clientHeight));
    ro.observe(stack);
    setTotal(stack.clientHeight);
    onCleanup(() => ro.disconnect());
  });

  const savePrefs = () =>
    void SetWebhookPanel(props.projectId, main.WebhookPanelPrefs.createFrom({ expanded: expanded(), fraction: fraction() }));
  const toggle = () => {
    setExpanded(!expanded());
    savePrefs();
  };

  const onResizeStart = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = panelEl.getBoundingClientRect().height;
    const all = total();
    let lastY = startY;
    let frame = 0;
    document.documentElement.classList.add("resizing-hooks");
    const px = () => clampPanel(startH + startY - lastY, all);
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        panelEl.style.height = `${px()}px`;
      });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.classList.remove("resizing-hooks");
      if (lastY === startY) return;
      setFraction(panelFraction(px(), all));
      panelEl.style.height = `${height()}px`;
      savePrefs();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const resetHeight = () => {
    setFraction(PANEL_DEFAULT_FRACTION);
    panelEl.style.height = `${height()}px`;
    savePrefs();
  };

  // ---- Create ----
  const create = createAction((name: string) => CreateWebhook(props.projectId, name));
  const startCreate = () => {
    if (!expanded()) toggle();
    setCreating(true);
    setNotConfigured(false);
    create.setError(undefined);
  };
  const submitCreate = async (e: SubmitEvent) => {
    e.preventDefault();
    const result = await create.run(newName().trim());
    if (!result) return;
    if (isNotConfigured(result.error)) {
      create.setError(undefined);
      setNotConfigured(true);
      setCreating(false);
      return;
    }
    if (result.data) {
      setNewName("");
      setCreating(false);
      await reloadWebhooks(); // never patched locally
      props.onOpen(result.data.id, result.data.name);
    }
  };

  // ---- Rename / delete / copy ----
  const startRename = (h: api.Webhook) => {
    setRowError(undefined);
    setRenameDraft(h.name);
    setRenamingId(h.id);
  };
  let renamingBusy = false;
  const submitRename = async () => {
    const id = renamingId();
    const h = webhooks().find((x) => x.id === id);
    if (!id || !h || renamingBusy) return;
    const name = renameDraft().trim();
    if (name === "" || name === h.name) return setRenamingId(undefined);
    renamingBusy = true;
    const result = await UpdateWebhook(id, main.WebhookPatchInput.createFrom({ name }));
    renamingBusy = false;
    handleProblem(result.error);
    setRowError(result.error?.message);
    if (!result.error) setRenamingId(undefined);
    await reloadWebhooks(); // open tabs relabel through MainScreen's sync
  };
  const copyURL = (h: api.Webhook) => {
    const d = effectiveDomain(h.domain, hookDomains());
    if (d.off) return;
    void ClipboardSetText(hookUrls(h.slug, d.domain).primary);
    clearTimeout(copiedTimer);
    setCopied(h.id);
    copiedTimer = setTimeout(() => setCopied(undefined), 1500);
  };
  const menuItems = (h: api.Webhook): MenuEntry[] => [
    { label: "Open", onSelect: () => props.onOpen(h.id, h.name) },
    { label: "Rename", icon: "pencil", onSelect: () => startRename(h) },
    { label: "Copy URL", icon: "duplicate", disabled: off(), onSelect: () => copyURL(h) },
    "separator",
    { label: "Delete", icon: "trash", danger: true, onSelect: () => setDeleting(h) },
  ];

  const count = () => webhooks().length;

  return (
    <section ref={panelEl} classList={{ "hooks-panel": true, expanded: expanded() }} aria-label="Webhooks"
      style={expanded() ? { height: `${height()}px` } : undefined}>
      <Show when={expanded()}>
        <div class="hooks-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize the webhooks panel"
          title="Drag to resize · double-click to reset" onPointerDown={onResizeStart} onDblClick={resetHeight} />
      </Show>
      <div class="hooks-bar">
        <button type="button" class="hooks-toggle" aria-expanded={expanded()} onClick={toggle}
          title={expanded() ? "Collapse webhooks" : "Show webhooks"}>
          <Icon name="chevron" class={expanded() ? "hooks-chevron open" : "hooks-chevron"} size={14} />
          <span class="menu-heading">Webhooks</span>
          <span class="hooks-count" aria-label={`${count()} endpoints`}>{count()}</span>
        </button>
        <button type="button" class="row-menu-trigger add" aria-label="New webhook endpoint"
          disabled={off()} title={off() ? NOT_CONFIGURED_TEXT : "New webhook endpoint"} onClick={startCreate}>
          <Icon name="plus" />
        </button>
      </div>
      <Show when={expanded()}>
        <div class="hooks-body">
          <Show when={creating() && !off()}>
            <form class="hooks-create" onSubmit={submitCreate}>
              <input type="text" placeholder="Endpoint name, e.g. Payme callbacks" aria-label="Endpoint name" value={newName()}
                disabled={create.pending()} maxLength={100} ref={(el) => queueMicrotask(() => el.focus())}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setCreating(false);
                    create.setError(undefined);
                  }
                }} />
              <div class="row">
                <button class="primary small-button" type="submit" disabled={create.pending() || newName().trim() === ""}>
                  {create.pending() ? "Creating…" : "Create"}
                </button>
                <button type="button" class="small-button" onClick={() => {
                  setCreating(false);
                  create.setError(undefined);
                }}>Cancel</button>
              </div>
              <FormError message={create.error()} />
            </form>
          </Show>
          <Show when={off() || notConfigured()}>
            <p class="hooks-note muted small">{NOT_CONFIGURED_TEXT}</p>
          </Show>
          <FormError message={rowError() || webhooksError()} />
          <Show when={webhooksLoaded()} fallback={<Show when={!webhooksError()}><p class="placeholder small tree-note">Loading…</p></Show>}>
            <Show when={count() > 0} fallback={
              <Show when={!off() && !creating()}>
                <p class="placeholder small tree-note">
                  No webhook endpoints yet — <button type="button" class="link-button" onClick={startCreate}>create one</button>
                </p>
              </Show>
            }>
              <ul class="hooks-list" aria-label="Webhook endpoints">
                <For each={webhooks()}>
                  {(h) => {
                    const state = () => listenState(h.id);
                    const unseen = () => feedOf(h.id)?.unseen ?? 0;
                    return (
                      <li classList={{ "hooks-row": true, open: props.isOpen(h.id) }}
                        onClick={() => renamingId() !== h.id && props.onOpen(h.id, h.name)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ hook: h, x: e.clientX, y: e.clientY });
                        }}>
                        <Icon name="webhook" class="hooks-row-icon" size={14} />
                        <Show when={renamingId() === h.id} fallback={<span class="hooks-row-name" title={h.name}>{h.name}</span>}>
                          <input class="tree-rename" aria-label="New name" value={renameDraft()} maxLength={100}
                            ref={(el) => queueMicrotask(() => {
                              el.focus();
                              el.select();
                            })}
                            onClick={(e) => e.stopPropagation()}
                            onInput={(e) => setRenameDraft(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void submitRename();
                              if (e.key === "Escape") setRenamingId(undefined);
                            }}
                            onBlur={() => void submitRename()} />
                        </Show>
                        <Show when={copied() === h.id}><span class="hooks-copied small">Copied</span></Show>
                        <Show when={unseen() > 0}>
                          <span class="unseen-badge" title={`${unseen()} new captured request${unseen() === 1 ? "" : "s"}`}>{unseen()}</span>
                        </Show>
                        <span classList={{ "listen-dot": true, [state()]: true }}
                          title={state() === "listening" ? "Listening (the tab is open)" : state() === "error" ? "Polling failed — retrying"
                            : state() === "paused" ? "Paused while the window is in the background" : "Not listening — open it to watch for requests"} />
                        <button type="button" class="row-menu-trigger" aria-label={`Actions for ${h.name}`} tabIndex={-1}
                          aria-haspopup="menu"
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            setMenu({ hook: h, x: e.detail === 0 ? r.left : e.clientX, y: e.detail === 0 ? r.bottom : e.clientY });
                          }}>
                          <Icon name="dots" />
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} label="Webhook actions" items={menuItems(m().hook)} onClose={() => setMenu(undefined)} />}
      </Show>
      <Show when={deleting()}>
        {(h) => (
          <ConfirmDialog title="Delete webhook endpoint"
            message={`Delete “${h().name}”? Its captured requests are deleted too, and senders get 404 from now on.`}
            confirmLabel="Delete endpoint"
            action={() => DeleteWebhook(h().id)}
            onDone={() => void reloadWebhooks()}
            onClose={() => setDeleting(undefined)} />
        )}
      </Show>
    </section>
  );
}
