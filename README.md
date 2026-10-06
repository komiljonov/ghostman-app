# Ghostman

A lightweight, fast API client (Postman alternative). This repository is the desktop app,
built with [Wails v2](https://wails.io) (Go backend + SolidJS/TypeScript frontend).

Ghostman is an **online-only client** of the Ghostman server (separate repo): you log in to
a server, and everything shared (teams, projects, requests, ...) lives there. Locally the app
keeps only the session token, response history and similar local-only data.

Current state: login/register/logout against the server, a Server URL setting, teams
(create, rename, delete, members, leave), invitations (invite, revoke, accept, reject),
projects (create, rename, delete, reorder) with per-member and per-project access, plus a
request editor: method, URL, query params, headers and a raw (JSON/Text/XML/custom) or
urlencoded form body; changes autosave; Send shows the response (pretty-printed JSON, headers)
and can be cancelled. Environments hold variables used as `{{KEY}}` anywhere in a request;
the active environment is picked in the top bar (right side); environments are edited in
tabs next to request tabs. **Secret** variables keep their values on this machine only —
they are never sent to the server. `{{KEY}}` tokens are highlighted in the URL, body and the
params/headers/form tables; hovering one shows its value and lets you edit it in place (secrets
after Reveal, saved locally only) or create a missing one in the active environment.
Keyboard: Ctrl+Enter (Cmd+Enter on macOS) sends the active request, Ctrl+Tab / Ctrl+Shift+Tab
switch tabs, Ctrl+W closes the active tab. In the sidebar tree: arrow keys select, Enter opens,
Ctrl+E renames, Del deletes, Ctrl+D duplicates a request; folders and requests can also be
dragged to move or reorder them. The URL field and the Params tab stay in sync both ways. The sidebar is resizable (drag its
edge; double-click to reset). HTML responses can be previewed in a sandboxed frame (no scripts). Tabs can be reordered by dragging; right-click a tab
for Close / Close Others / Close All. Settings has a System / Dark / Light theme.

The window is laid out Postman-style: a top bar with team and project switchers (their menus
also hold "+ New …" and the team/project settings) and a profile menu (invitations, settings,
log out); a left sidebar with the project's folders & requests;
and a main pane with the request editor tabs. The selected team and project, and each
project's open tabs, are remembered across restarts.

The sidebar shows the current project's folders and requests: create, rename inline, move
(Move to…, Move up/down) and delete from each row's ⋯ / right-click menu. Clicking a request
opens it in a tab. Folder expand/collapse state is remembered per project.

## Prerequisites

| Tool | Version | Install |
| --- | --- | --- |
| Go | 1.25+ | https://go.dev/dl/ |
| Node.js | current LTS | https://nodejs.org/ |
| Wails CLI | v2 | `go install github.com/wailsapp/wails/v2/cmd/wails@latest` |
| go-task | v3 | https://taskfile.dev/installation/ (`winget install Task.Task`, `brew install go-task`, `snap install task --classic`) |
| sqlc | 1.3x | https://docs.sqlc.dev/en/latest/overview/install.html (only needed when changing SQL) |
| golangci-lint | v2 | https://golangci-lint.run/welcome/install/ (only needed for `task lint`) |

No C toolchain is needed: SQLite is the pure-Go `modernc.org/sqlite` driver (no CGO).

Platform notes:

- **Windows:** the app renders with Microsoft Edge **WebView2**, which is preinstalled on
  Windows 10 (recent updates) and Windows 11. Nothing else to install.
- **Linux:** Wails needs GTK3 and WebKit2GTK dev packages, e.g. on Debian/Ubuntu
  `sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config`
  (use `wails build -tags webkit2_41` on distros that only ship webkit2gtk-4.1).

Run `wails doctor` to check your machine.

## Quickstart

```sh
task dev              # hot-reload dev window (also serves http://localhost:34115 for browser devtools)
task build            # production binary in build/bin/
```

## Tasks

| Command | What it does |
| --- | --- |
| `task dev` | `wails dev` |
| `task build` | `wails build` |
| `task test` | `go test ./...` + frontend unit tests (vitest) |
| `task lint` | `golangci-lint run ./...` |
| `task frontend:check` | `tsc --noEmit` in `frontend/` (installs deps first if needed) |
| `task sqlc` | regenerate Go from `internal/store/queries/*.sql` (schema = migrations dir) |
| `task migrate:create -- <name>` | new goose SQL migration in `internal/store/migrations/` |

Migrations are embedded in the binary and applied automatically at startup.

## Server connection

The app needs a running Ghostman server. For development, start it from the server repo
(`task dev`, which also starts its PostgreSQL); it listens on `http://localhost:8080`, the
app's built-in default.

- **Change the server** from the gear icon (top-right on the login, register and main
  screens). The value is stored in the local database and survives restarts. Switching
  servers logs you out.
- **Release builds** (`task build`) default to `https://api.ghostman.uz`; dev builds
  (`task dev`) to `http://localhost:8080`. Another default: `task build SERVER_URL=https://...`
  (sets `main.defaultServerURL` via `-ldflags`). Environment variables and `.env` files are
  never used for this.
- If the server cannot be reached, the app shows a "Cannot reach server" screen with the URL,
  the reason, and an inline field to fix it; wrong credentials are shown under the login form.

## Data location

The SQLite database lives at `%AppData%\Ghostman\ghostman.db` on Windows and
`~/.config/Ghostman/ghostman.db` on Linux (`$XDG_CONFIG_HOME` respected).
Set `GHOSTMAN_DB=/path/to/file.db` to use a different file (handy for development).

## Project layout

```
main.go, app.go      Wails bootstrap and the App struct bound to the frontend
internal/engine/     HTTP request engine
internal/store/      SQLite + goose migrations + sqlc-generated queries
frontend/            Vite + SolidJS + TypeScript (view layer only)
frontend/wailsjs/    TS bindings generated by Wails — committed, do not edit
build/               Wails platform assets (icons, manifests); build/bin/ is output
```

See [CLAUDE.md](CLAUDE.md) for the architectural rules.

## Debugging

- **Frontend:** in `task dev`, right-click → Inspect in the app window, or open
  http://localhost:34115 in a browser (bound Go methods work there too).
- **Go side (VS Code, needs the Go extension + Delve — it offers to install `dlv`):** run the **"Ghostman: debug Go (built frontend)"** launch config.
  It builds the frontend once (`npm run build`), then starts the app under Delve with
  `-tags dev`, serving `frontend/dist` from disk. Breakpoints work in `app.go` and
  `internal/`. Frontend changes need a restart in this mode — use `task dev` when you want
  hot reload and don't need Go breakpoints. (Attaching Delve to the process `wails dev`
  spawns is possible but fragile, since it's rebuilt on every Go change.)
- Go logs are `log/slog` text lines on stderr (visible in the `task dev` terminal).
