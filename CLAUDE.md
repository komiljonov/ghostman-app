# Ghostman desktop app

Ghostman is a lightweight, fast API client (Postman alternative). This repo is the
Wails desktop app only. The Go server lives in a separate repo (`../ghostman`).

## Architecture: online-only client

Online-only client. Server API (Go, REST, /api/v1) is the source of truth for
teams/projects/folders/requests/environments. SQLite holds ONLY local-only data: session
token, secret variable values, active environment, response history, UI state. No server
data is cached locally in v1.

Server URL: compiled-in default (localhost:8080 in dev builds), user-overridable via the
settings table (key server_url). Never .env for shipped behavior. The default lives in
`main.defaultServerURL`; `task build` links in the production server
`https://api.ghostman.uz` (`PROD_SERVER_URL` in Taskfile.yml, via `-ldflags -X
main.defaultServerURL=...`); `task build SERVER_URL=https://...` overrides it. A bare
`wails build` keeps localhost — release builds go through `task build`.

## Fixed decisions (do not revisit without the owner)

- **Wails v2** (NOT v3) + **Go 1.25+**. Frontend: **SolidJS + TypeScript + Vite**. No React, no Next.js.
- **Local storage:** SQLite via `modernc.org/sqlite` (pure Go, no CGO — must build on Windows
  and Linux without a C toolchain). **goose** migrations, plain SQL, embedded via `embed.FS`,
  run on app startup.
- **sqlc** for queries (engine `sqlite`), schema derived from the migrations dir. **No ORM.**
- **All app logic lives in Go** (`internal/...`): request engine, storage, server client.
  The frontend is a thin view layer — it calls Wails-bound Go methods and renders.
  **No business logic in TS.** One owner-approved exception: cascading per-node settings are
  resolved in TS (`src/settingsResolver.ts`), purely over the already-fetched tree, so labels
  re-resolve live without bridge calls; Go only stores/forwards the values.
- **Heavy data stays on the Go side:** responses are stored in Go/SQLite; the frontend
  receives only what it renders. Never pass multi-MB payloads across the Wails bridge by
  default (response bodies are truncated to 256 KB before crossing it).
- **Solid conventions:** never destructure props; use `<For>`/`<Show>`; components live in
  `frontend/src/components/`, one per file. Solid signals only — no external state lib.
- `log/slog` for Go logging. **go-task** (`Taskfile.yml`) for commands. Everything must work
  identically on Windows and Linux.
- Domain features (teams, projects, folders, environments, tabs) are **not designed into
  client code yet** — do not invent them beyond what exists.
- **Errors reaching the UI are human messages**, never raw JSON or Go error dumps. Expected
  failures (server errors, unreachable server, invalid input) are returned as a typed
  `Problem{kind,status,code,message}` inside the bound method's result — not as a rejected
  promise, because the Wails runtime flattens rejected values to `Error(string)`.
  Server-backed bound methods return `{data, error}` (one concrete result type per shape —
  Wails v2 cannot bind generics); a 401 re-checks the session so the UI drops to login.
- **Server data is never patched locally:** after a successful mutation the UI re-fetches
  the affected list/view from the server. Server-shaped structs keep the server's
  snake_case JSON names end to end.
- **Never log credentials**: no passwords, tokens or Authorization headers in slog output.
- **Secret variable values never reach the server** (the product's security promise). They
  live only in local SQLite (`secret_values`, keyed by environment id + variable KEY). All
  variable writes go through `internal/envs`, which re-reads the variable's type from the
  server before writing a value and routes secrets to local storage; `api.UpdateVariable`
  also refuses a value together with type secret, and `api.NewVariable` has no value field.
  Never log secret values; history rows and logs keep the unresolved `{{template}}` URL.

## UI layout (the standard — new features must fit into it)

Postman-style shell, logged in:

- **Top bar**, left to right: "Ghostman" · **Team switcher** (my teams with owner badge and
  member count, "+ New team", "Team settings") · **Project switcher** (accessible projects of
  the current team in sort order, "+ New project", "Project settings") · refresh (↻) · on the
  right the **env switcher** and then the **profile badge** (initials) whose menu holds user
  name/email, Invitations (count badge), Settings (server URL modal), Log out.
- **Left sidebar**: only the current project's folders/requests tree (`ProjectTree`). Never
  teams, invitations or other navigation. The tree is built client-side (`src/tree.ts`, unit
  tested) from ONE ListFolders + ONE ListRequests call and rebuilt after every mutation;
  rows are keyed by id and expansion is per-node state (persisted locally under
  `ui_tree_state_<project_id>`), so expand/collapse never rebuilds the tree. Row actions live
  in the shared context menu (⋯ or right-click); "+" at the top creates at the project root.
  Rows: indent 16 px per level · chevron + folder icon (folders) or the method badge in the
  same 36 px column (requests) · name, so names align per depth.
  The sidebar is **resizable**: a handle on its right edge (180 px to half the window,
  double-click → 260 px) rewrites only the `--sidebar-width` CSS variable while dragging
  (no re-render) and saves once on release (`ui_sidebar_width`, bound `SetSidebarWidth`;
  `GetUIPrefs` on startup, `src/uiPrefs.ts`).
- **Tree selection & keys** (`src/treeNav.ts`, unit tested): click selects, and the selection
  follows the active request tab. With the tree focused: Up/Down move, Right expands/enters,
  Left collapses/goes to the parent, Enter opens (or toggles a folder), Home/End, Shift+F10
  opens the row menu; **Ctrl+E** inline rename, **Del** delete (existing confirm), **Ctrl+D**
  duplicate (requests only; no-op on folders). Never while the rename input, any input or
  editor has focus, or a modal is open (`canUseTreeKeys`).
- **Tree drag-and-drop** (rules: `src/treeDnd.ts`, unit tested; pointer wiring:
  `src/treeDrag.ts`): a press becomes a drag after 5 px (clicks and context menus unaffected).
  Folder row: top 25% before · bottom 25% after (collapsed only) · else INTO (at the end);
  request row: top/bottom half before/after; below the last row → end of the root. Inserts
  land among the dragged kind's siblings (folders first, then requests). A folder never drops
  into itself or its subtree (no indicator, no-drop cursor; the server's 400 is still shown).
  Ghost follows the cursor, insertion line / folder highlight, a collapsed folder opens after
  700 ms of hovering, the sidebar auto-scrolls near its edges, Escape cancels. A drop is one
  bound Go call, `PlaceNode` (`api.Place`: move if the parent changes, then reorder the
  target's full sibling list if an insert position was chosen), then the usual re-fetch.
  Keyboard/menu moves stay.
- **Duplicate request** is one bound Go call, `DuplicateRequest` (`api.DuplicateRequest`):
  get → create "<name> copy" in the same folder → patch method/url/headers/params/body; if a
  step after the create fails, the half-made copy is deleted and one error is returned. The UI
  then re-fetches the tree and selects + opens the copy (`src/treeActions.ts`).
- **Context menu**: one component, `ContextMenu.tsx`, for tree rows and tabs. Its top-left
  corner sits at the pointer and it flips per axis at the window's right/bottom edge so a
  corner stays on the cursor (`src/menuPosition.ts`, unit tested); compact (13 px, icon +
  label + right-aligned shortcut hint, separators, 160–240 px). It owns the keyboard while
  open (Up/Down/Enter/Escape; key events stop there — Solid delegation would otherwise
  bubble them out of the Portal into the owner, e.g. the tree).
- **Env switcher** (top bar, right side, left of the profile badge): "No environment", the
  project's environments (a pencil on each opens it in an env tab), "Manage environments…"
  (opens the environments list tab). The active environment is per project
  (`active_env_<project_id>`), validated on load.
- **Main pane**: the **tabs** by default, or Team settings / Project settings / Invitations
  when opened. Empty state without tabs. Tabs are typed (`src/tabModel.ts`):
  `request` (method | URL (stretches) | Send / Cancel in one fixed slot at the far right;
  Params | Headers | Body | Settings with the save status at the row's right end; response below a
  draggable divider), `env` (that environment's variables table) and `env_list`
  (create / rename / reorder / delete environments). There is no separate environments page.
- **Tabs** are per project, persisted as typed refs in tab-bar order (`ui_tabs_<project_id>`;
  the old bare-id format is read as request tabs and rewritten) and restored on startup (gone
  targets dropped silently). Tree renames/deletes relabel/close request tabs; environment
  renames/deletes relabel/close env tabs. Tabs reorder by dragging (pointer events, 5 px
  threshold so clicks stay clicks; drop indicator; ghost clamped to the bar); middle-click or ×
  closes. Right-click opens the tab menu: Close / Close Others / Close All (`tabsToClose`;
  tabs close one at a time through the normal close, so each flushes its pending save).
- **Shortcuts** (one action table, `shortcutAction` in `src/tabModel.ts`): Ctrl/Cmd+Enter sends,
  Ctrl+Tab / Ctrl+Shift+Tab cycle tabs in bar order (wrapping), Ctrl/Cmd+W closes the active
  tab. Two entry points, both calling `shortcuts.runShortcut()`: one window keydown handler
  (bubble phase, skips events CodeMirror already handled) and a `Prec.highest` CodeMirror
  keymap. Both `preventDefault`, which is enough for WebView2: Ctrl+W never closes or blanks
  the window (verified with real OS keystrokes in `wails dev` and a built exe), so no Wails
  accelerator is needed. Ignored with a modal open or outside the tabs pane; Send is also
  ignored on env tabs or while that tab is sending — no queueing; Ctrl+W with no tabs is a no-op.
- **URL ↔ Params** (`src/urlParams.ts` is the spec, with its test table): `url` stores only the
  base (before "?"); `query_params` is the one source of truth for the query. The URL input
  shows base + enabled keyed rows as `k=v&…` (empty value → `k=`; no "?" without any). Typing
  in it re-derives pairs (split on "&", then the first "="; verbatim, no percent-coding —
  Go encodes at send time) and reconciles them IN ORDER into the enabled keyed rows (update
  in place, append extras, delete missing); disabled and keyless rows are never touched.
  Params-tab edits rewrite the URL input via an annotated CodeMirror transaction (not echoed
  to onChange, not in undo history), and only when its text does not already mean the same
  (`sameMeaning`), so typing is never rewritten. A legacy `url` with a query has its pairs
  moved into the rows on load (persisted with the next edit, never on open).
- **Autosave is the save model** (no dirty tabs, no Save button): 600 ms debounce per tab,
  one PATCH with only the changed fields (built in Go: `api.BuildRequestPatch`, which drops
  keyless rows), one save in flight per tab with last write winning, flushed on tab
  close/switch, project switch, Send, and window close (Go's OnBeforeClose asks the UI to
  flush, then `ConfirmQuit`). Status (`SaveIndicator`): dot + muted "Saved", amber
  "Saving…", red "Not saved — retry" (click retries; the tab also shows a red dot). A failed
  save keeps the edits.
- **Sending** happens in Go (`internal/engine`): enabled rows only, query params appended to
  any query already in the URL, raw/form body with its Content-Type unless a header sets one,
  JSON responses pretty-printed in Go (`rawBody` carries the original, only then), 256 KB cap,
  cancellable per request. Response state is per tab and never persisted.
  **Redirects are followed by the engine itself** (`internal/engine/redirect.go`; the
  http.Client never auto-follows), mirroring net/http exactly: 301/302/303 → GET without body
  (dropped for good), 307/308 keep method + body, relative Locations resolved, Authorization /
  Cookie & co. dropped once the chain leaves the initial host for a non-subdomain, body headers
  dropped with the body, custom Host only on relative redirects, Referer set (not https→http),
  at most 10 requests ("stopped after 10 redirects", the chain kept). One deadline covers the
  whole chain. **Follow redirects is a cascading setting**: requests and folders store
  `follow_redirects` = inherit | global | on | off **on the server** (shared with the team, in
  the list + GET payloads); the global value is local (Settings modal, settings key
  `follow_redirects_default`, default on; `src/redirectDefault.ts`). **Resolver**
  (`src/settingsResolver.ts`, setting-agnostic, the mechanism for future auth/proxy settings):
  on/off at a level → that value from that node; `global` → the global value and the walk
  STOPS; `inherit` → next ancestor folder; past the root → global. It runs over the **tree
  store** (`src/treeStore.ts`: ProjectTree publishes every fetched tree), so open tabs
  re-resolve on a folder change, a move or a global toggle with no extra calls. UI: the
  request's **Settings sub-tab** (Params | Headers | Body | Settings) and a folder's
  **Settings…** (context menu → modal), both with "Inherit from parent — currently: on (from
  folder ‘X’ / global)" · "Use global setting — currently: …" · Always · Never; a dot on the
  sub-tab when the value is not inherit. Saving PATCHes the node (bound
  `SetRequestFollowRedirects` / `SetFolderFollowRedirects`, values validated in Go), then the
  tree is re-fetched. TS passes the resolved boolean to `SendRequest`. Off → the 3xx is the
  response. **One-time migration**: old local `request_settings` rows (Always→on, Never→off)
  are pushed by `MigrateLegacyRequestSettings` on the first logged-in load (each row deleted
  once pushed; 404/403 rows dropped; other failures — a 400 from an older server too — retried
  next time), then the table is dropped. **Per-hop timing** (`internal/engine/trace.go`, httptrace): every hop records
  dns / connect (TLS folded in) / wait (TTFB) / download / total ms, connection reuse and remote
  address; a phase that did not happen is null (never 0); a failed hop names the phase it died
  in. `Response.Hops` and `SendResult.Hops` (also on failure, via `engine.SendError`) carry
  them; local secret values are masked (`••••`) in hop URLs. History still stores the total.
  The engine also
  keeps the **full body** (`engine.Response.Full`, `json:"-"`, capped at 20 MB, `FullCapped`)
  Go-side only: `responses.go` holds it per request tab for the ACTIVE response (replaced by
  the next send — only if that send is still current —, dropped on a failed send, on tab close
  via `ReleaseResponse`, when `SetTabs` no longer lists the tab, on controller dispose and on
  logout). It never crosses the bridge.
- **Response pane** (`ResponseView.tsx`, rules in `src/responseView.ts`): one toolbar row —
  Body | Headers left; right: Pretty | Raw | Preview, Wrap, search · collapse all · expand all ·
  save icons, then status · duration · size as one fixed cluster (in a narrow pane the cluster
  wraps to a second row — width-dependent, never mode-dependent). Pretty for formatted JSON
  (collapsible) or truncated JSON (flat text + "structure view unavailable" notice); **Preview only for `text/html`**, rendered in an
  iframe with an **empty `sandbox`** (no scripts, opaque origin), `srcdoc` = the truncated
  body, `referrerpolicy=no-referrer`, white page in both themes (absolute URLs load, relative
  ones break — accepted). A new response resets the view (Preview for HTML, Pretty for JSON,
  else Raw); Wrap is global (`ui_response_wrap`).
- **Timing panel** (`TimingPanel.tsx`, model in `src/timingModel.ts`): the toolbar's duration is
  the trigger (dotted underline; disabled without hops, also enabled after a failed send). One
  section per hop — status · method · URL · total, a stacked bar in the phase tokens
  (`--phase-dns/connect/wait/download`) and a phase table ("reused" for DNS/connect on a reused
  connection, "—" for a phase that did not happen, the failed phase in red with the error);
  a single hop has no numbering, a chain shows ①②… and "N hops · total" (sticky footer). Per
  tab, reset by every send.
- **Response body viewer** (`src/responseViewer.ts`, `ResponseBody.tsx`): a read-only CodeMirror
  6 view for Pretty and Raw (viewport rendering — smooth at 256 KB; native selection; keyboard
  scrolling). Pretty JSON folds: gutter ▾/▸, collapsed nodes read `{…} 12 keys` / `[…] 48 items`
  (`src/jsonFold.ts`: fold range = after the opening bracket through the closing one; Collapse
  All = the root's children, depth 1). Fold state is per tab (`responseFolds`), reset by a new
  response. **Search** (`src/responseSearch.ts`): plain text, case-insensitive by default (Aa),
  bar docked above the body, counter, Enter/Shift+Enter/▲▼ wrap, Escape closes and clears; all
  offsets found in one pass, but only matches in the visible ranges are decorated. Matches and
  the counter always cover the FULL text, collapsed or not (folding keeps the text in the
  document); a jump to a hidden match unfolds exactly the folds covering it (its collapsed
  ancestors, `jsonFold.revealEffects`) in the same transaction that scrolls to it. Typing never
  expands anything (current = first unhidden match, else "–/N" until Enter); closing search
  keeps whatever expansion navigation produced. **Ctrl/Cmd+F rule** (`responseFindTarget`): the request body
  editor keeps CodeMirror's own search (it handles the key first); with focus in the response
  pane, or the pointer over it while no other editable has focus, Ctrl+F opens this search.
  **Right-click**: body → Copy (needs a selection) / Copy All (text as displayed) / Search in
  response (prefilled); headers → Copy value / Copy "Key: value" / Copy All headers; none in
  Preview. Clipboard via the Wails runtime (`ClipboardSetText`).
- **Save response to file**: toolbar download icon (any view, once a response exists) → bound
  `SaveResponseToFile(tabID)`: native save dialog (`runtime.SaveFileDialog`, behind the
  `saveDialog` field so tests mock it), default name = request name (sanitized) + extension
  by Content-Type (json/html/xml/txt/bin), writes the full Go-side bytes; returns
  `{path, bytes_written, truncated_at_cap}`; cancel = no data, no error. The UI shows a toast
  (no layout shift), mentioning the 20 MB cap when it applied.
- **Controls never vanish or move on a mode/type switch**: what does not apply is disabled
  (muted, tooltip says why), not hidden — response toolbar, body content-type controls,
  Send/Cancel slot. New UI follows the same rule.
- **Icons**: inline SVGs on a 16 px grid in `components/Icon.tsx` (one component, `currentColor`,
  no icon font or package). Add shapes there; no text glyphs as icons.
- **`{{var}}` resolution** happens in Go at send time (`internal/engine/resolve.go` is the
  single source of truth, with its spec comment and table test): exact, case-sensitive
  keys; unknown keys and secrets without a local value stay literal and are reported
  (response banner); no recursion. Map = active env's regular values + local secret values.
  `src/vars.ts` mirrors only the token grammar for highlighting (keep both test tables in
  step). URL and raw body are CodeMirror editors with the shared highlight/hover extension
  (`src/codemirror.ts`); hover reads the Solid env store (`src/envStore.ts`), never the bridge.
  The params/headers/form tables use `VarCell`: a plain focusable div with `{{var}}` spans that
  mounts a single-line CodeMirror editor only while focused, hovered or editing in a tooltip
  (`src/cellMode.ts`), so a 30-row table has at most one or two live editors. The env
  variables table stays plain inputs.
- **Editing from the hover tooltip** (`tooltipActions` / `saveFromTooltip` in `src/vars.ts`,
  bridge calls in `src/varEdit.ts`): a resolved var shows Edit; a secret shows Reveal, then
  Edit (saved through `SetVariableValue`, so it stays local); an unresolved var with an active
  env offers "Create in <env>" (creates a regular variable). Edit pins the tooltip (stays open
  without the pointer); Enter or blur saves, Esc cancels; the env context is re-fetched after.
- **Theme**: System / Dark / Light in Settings, stored locally (settings key `theme`, bound
  `GetTheme`/`SetTheme`, works logged out); `<html data-theme>` selects a token set and
  "system" follows `prefers-color-scheme` live (`src/theme.ts`). **Every color is a design
  token in `src/tokens.css`** (CodeMirror theme and syntax colors included): no hex/rgb/hsl/
  white/black literals anywhere else in `frontend/src` — `ui_tokens_test.go` fails the build.
- **Current team/project** live in Go (`internal/workspace`), persisted in settings
  (`current_team_id`, `current_project_id`) and validated against fresh server lists on every
  load: a vanished team falls back to the first team with no project, a vanished project to no
  project; switching team selects its first project. Views tied to a team/project close when
  the selection changes. The UI refreshes on window focus, when a switcher opens, and via ↻.
- Dropdowns close on outside click and Escape. Destructive actions confirm inline.

## Code layout

```
main.go, app.go          Wails bootstrap + the bound App struct (thin: delegates to internal/)
teams.go                 bound team/invitation methods: thin {data, error} wrappers over api
projects.go              bound project/access methods (same pattern)
workspace.go             bound current-team/project selection (LoadWorkspace, SelectTeam, SelectProject)
tree.go                  bound folder/request methods + local tree state (GetTreeState/SetTreeState)
editor.go                bound editor methods: SaveRequest (autosave patch), SendRequest/CancelRequest,
                         GetTabs/SetTabs (typed tab refs, legacy migration), quit handshake
environments.go          bound environment/variable methods + local secret access
theme.go                 bound theme preference (GetTheme/SetTheme, local settings)
uiprefs.go               bound layout prefs (GetUIPrefs, SetSidebarWidth, SetResponseWrap)
responses.go             full response bodies per tab (Go-side), SaveResponseToFile, ReleaseResponse
redirects.go             follow-redirects: local global value, node setters (server), legacy local→server push
ui_tokens_test.go        fails on color literals outside frontend/src/tokens.css
internal/engine/         HTTP request engine (the product core)
internal/api/            typed client for the Ghostman server API (/api/v1)
internal/session/        server URL resolution, auth state machine, login/logout/settings
internal/workspace/      current team/project selection: persist, validate, fall back
internal/envs/           environments: active env, variables with local-only secrets, var map
internal/store/          SQLite open/migrate, sqlc output (*.sql.go, db.go, models.go)
  migrations/            goose SQL migrations (embedded, also the sqlc schema)
  queries/               sqlc query files
frontend/                Vite + Solid + TS
  src/components/        one component per file
  wailsjs/               generated by Wails (bindings + models) — do not edit by hand
```

## Workflow

- `task dev` / `task build` / `task test` / `task lint` / `task frontend:check`
- Linux binary: `task build:linux` (Docker, any host — Wails v2 cannot cross-compile to Linux;
  `build/linux/Dockerfile`, WebKitGTK 4.1 via `-tags webkit2_41`) or `task build:linux:native`.
- After changing SQL in `migrations/` or `queries/`: `task sqlc` (never edit generated `*.sql.go`).
- New migration: `task migrate:create -- <name>`.
- Frontend unit tests (vitest, pure logic only, node environment): `task frontend:test`;
  `task test` runs Go + frontend tests.
- After changing bound Go method signatures or their structs, `wails dev`/`wails build`
  regenerate `frontend/wailsjs/` (or run `wails generate module`).

## Backlog (deliberately deferred)

- `{{var}}` **autocomplete** on typing `{{`; variable usage search; env duplication;
  dynamic/generated variables.
- More cascading settings through the same resolver (auth, proxy, timeout, TLS / insecure);
  the Settings sub-tab and the folder Settings… modal are their home.
- Response search: regex mode.
- Per-request auth; cookies; response history UI
  (history rows are already written on every send); multipart/file bodies.
- **Drag-and-drop for the project list**: for now projects use ↑/↓ in Project settings. Reorder
  endpoints need the full sibling set (every team project, so only the team owner and
  all-projects members get ↑/↓).
