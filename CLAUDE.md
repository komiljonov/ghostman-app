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
`main.defaultServerURL`; release builds override it with
`task build SERVER_URL=https://...` (`-ldflags -X main.defaultServerURL=...`).

## Fixed decisions (do not revisit without the owner)

- **Wails v2** (NOT v3) + **Go 1.25+**. Frontend: **SolidJS + TypeScript + Vite**. No React, no Next.js.
- **Local storage:** SQLite via `modernc.org/sqlite` (pure Go, no CGO — must build on Windows
  and Linux without a C toolchain). **goose** migrations, plain SQL, embedded via `embed.FS`,
  run on app startup.
- **sqlc** for queries (engine `sqlite`), schema derived from the migrations dir. **No ORM.**
- **All app logic lives in Go** (`internal/...`): request engine, storage, server client.
  The frontend is a thin view layer — it calls Wails-bound Go methods and renders.
  **No business logic in TS.**
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
  Params | Headers | Body with the save status at the row's right end; response below a
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
- **Response pane** (`ResponseView.tsx`, rules in `src/responseView.ts`): one toolbar row —
  Body | Headers left; right: Pretty | Raw | Preview, Wrap, then status · duration · size in
  fixed slots. Pretty only for formatted JSON; **Preview only for `text/html`**, rendered in an
  iframe with an **empty `sandbox`** (no scripts, opaque origin), `srcdoc` = the truncated
  body, `referrerpolicy=no-referrer`, white page in both themes (absolute URLs load, relative
  ones break — accepted). A new response resets the view (Preview for HTML, Pretty for JSON,
  else Raw); Wrap is global (`ui_response_wrap`).
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
- After changing SQL in `migrations/` or `queries/`: `task sqlc` (never edit generated `*.sql.go`).
- New migration: `task migrate:create -- <name>`.
- Frontend unit tests (vitest, pure logic only, node environment): `task frontend:test`;
  `task test` runs Go + frontend tests.
- After changing bound Go method signatures or their structs, `wails dev`/`wails build`
  regenerate `frontend/wailsjs/` (or run `wails generate module`).

## Backlog (deliberately deferred)

- `{{var}}` **autocomplete** on typing `{{`; variable usage search; env duplication;
  dynamic/generated variables.
- Per-request auth; cookies; response history UI
  (history rows are already written on every send); multipart/file bodies.
- **Drag-and-drop for the project list**: for now projects use ↑/↓ in Project settings. Reorder
  endpoints need the full sibling set (every team project, so only the team owner and
  all-projects members get ↑/↓).
