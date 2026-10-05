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
  in a ⋯ / right-click menu; "+" at the top creates at the project root.
- **Env switcher** (top bar, right side, left of the profile badge): "No environment", the
  project's environments (a pencil on each opens it in an env tab), "Manage environments…"
  (opens the environments list tab). The active environment is per project
  (`active_env_<project_id>`), validated on load.
- **Main pane**: the **tabs** by default, or Team settings / Project settings / Invitations
  when opened. Empty state without tabs. Tabs are typed (`src/tabModel.ts`):
  `request` (method, URL, Send / Cancel, save indicator; Params | Headers | Body; response
  below a draggable divider), `env` (that environment's variables table) and `env_list`
  (create / rename / reorder / delete environments). There is no separate environments page.
- **Tabs** are per project, persisted as typed refs in tab-bar order (`ui_tabs_<project_id>`;
  the old bare-id format is read as request tabs and rewritten) and restored on startup (gone
  targets dropped silently). Tree renames/deletes relabel/close request tabs; environment
  renames/deletes relabel/close env tabs. Tabs reorder by dragging (pointer events, 5 px
  threshold so clicks stay clicks; drop indicator; ghost clamped to the bar); middle-click or ×
  closes.
- **Ctrl/Cmd+Enter** sends the active request tab from anywhere: one window keydown handler
  plus a highest-precedence CodeMirror binding, both calling `shortcuts.triggerSend()` (the
  window handler skips events CodeMirror already handled). Ignored on env tabs, with a modal
  open, or while that tab is already sending — no queueing.
- **Autosave is the save model** (no dirty tabs, no Save button): 600 ms debounce per tab,
  one PATCH with only the changed fields (built in Go: `api.BuildRequestPatch`, which drops
  keyless rows), one save in flight per tab with last write winning, flushed on tab
  close/switch, project switch, Send, and window close (Go's OnBeforeClose asks the UI to
  flush, then `ConfirmQuit`). A failed save keeps the edits and shows "Not saved — retry".
- **Sending** happens in Go (`internal/engine`): enabled rows only, query params appended to
  any query already in the URL, raw/form body with its Content-Type unless a header sets one,
  JSON responses pretty-printed in Go, 256 KB cap, cancellable per request. Response state is
  per tab and never persisted.
- **`{{var}}` resolution** happens in Go at send time (`internal/engine/resolve.go` is the
  single source of truth, with its spec comment and table test): exact, case-sensitive
  keys; unknown keys and secrets without a local value stay literal and are reported
  (response banner); no recursion. Map = active env's regular values + local secret values.
  `src/vars.ts` mirrors only the token grammar for highlighting (keep both test tables in
  step). URL and raw body are CodeMirror editors with the shared highlight/hover extension
  (`src/codemirror.ts`); hover reads the Solid env store (`src/envStore.ts`), never the bridge.
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

- `{{var}}` **autocomplete** on typing `{{`; highlighting inside the params/headers/form
  tables (they resolve at send time already); variable usage search; env duplication;
  dynamic/generated variables.
- Per-request auth; cookies; response history UI
  (history rows are already written on every send); multipart/file bodies.
- **Drag-and-drop** for the project list and the folders/requests tree: for now projects use
  ↑/↓ in Project settings and tree rows use Move up / Move down / Move to… in their context
  menu. Reorder endpoints need the full sibling set (projects: every team project, so only
  the team owner and all-projects members get ↑/↓).
