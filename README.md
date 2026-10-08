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
Typing `{{` suggests the project's variables: those of the active environment first (with a value
preview; secrets show a lock), then keys that exist only in other environments (dimmed, "in prod").
Keyboard: Ctrl+Enter (Cmd+Enter on macOS) sends the active request, Ctrl+Tab / Ctrl+Shift+Tab
switch tabs in the focused group, Ctrl+W closes the active tab, Ctrl+\ splits it to the right,
Ctrl+1..9 focuses editor group N. In the sidebar tree: arrow keys select, Enter opens,
Ctrl+E renames, Del deletes, Ctrl+D duplicates a request; folders and requests can also be
dragged to move or reorder them. The URL field and the Params tab stay in sync both ways. Params, headers and form fields have a **Bulk edit** view: one `key:value` per line (Postman's format; everything after the first colon is the value, so JSON values survive; `//key:value` is a disabled row; a space after the colon is part of the value). The choice is remembered per kind for all requests. A raw JSON body can be pretty-printed with **Format** (or Ctrl+Shift+F in the body editor); `{{variables}}` may stand anywhere, even outside quotes, and are kept exactly as typed; invalid JSON is left alone with a hint naming the line and column. The sidebar is resizable (drag its
edge; double-click to reset). A **jq filter bar** under the response narrows JSON responses (e.g. `.data[] | select(.revenue > 1000)`; ? shows examples); the filter is saved on the request for the whole team, re-applied to new responses, and the filtered result can be copied or saved. HTML responses can be previewed in a sandboxed frame (no scripts); images, audio and video play in Preview, PDFs and other binary data can be saved. In the response: Ctrl+F searches the body,
JSON objects/arrays collapse (gutter, or Collapse All / Expand All), right-click copies, and the
download icon saves the full response (up to 20 MB, even when only 256 KB is shown). Click the
duration for per-hop timing (DNS, connect, waiting, download — one section per redirect); whether
redirects are followed cascades: a request or folder can follow, not follow, use the global value
(Settings, this machine) or inherit from its folder — set in the request's Settings tab or a
folder's Settings…, shared with the team. The editor splits into **groups**, like VS Code: drag a
tab onto another tab bar to move it, or onto an edge of a group to split there (the preview shows
where it lands; Escape cancels); drag the dividers to resize (double-click → equal). Right-click a
tab for Close / Close Others / Close All, Split Right / Split Down and Move to Group N. Settings has a System / Dark / Light theme.
**Auth** (the request's Auth sub-tab, and a folder's Settings…): Bearer token, Basic auth or an
API key (header or query parameter); "Inherit from parent" uses the nearest folder that sets auth
(or none), "No auth" sends nothing even inside such a folder. Values can use `{{variables}}` —
put credentials in a **secret** variable (`{{API_TOKEN}}`): auth settings themselves are saved on
the server for the whole team, secret values never are. A header or query parameter you write
yourself with the same name (e.g. your own `Authorization` header) wins over the one built from
the Auth settings.
**History** (profile menu → History) lists every request sent from this computer, newest first,
grouped by day, with search and method / status / project filters; an entry shows the request
as authored and as sent, the response and its timing, and can be restored as a new request. Media responses
(images, audio, video, PDFs, other binary data) are kept too: images and audio/video play right in
the entry, and any stored response can be saved to a file.

The window is laid out Postman-style: a top bar with team and project switchers (their menus
also hold "+ New …" and the team/project settings) and a profile menu (invitations, settings,
log out); a left sidebar with the project's folders & requests;
and a main pane with the request editor tabs. The selected team and project, and each
project's open tabs and editor-group layout (per user), are remembered across restarts.

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
task build            # production binary for this OS in build/bin/
task build:linux      # Linux amd64 binary, built in Docker (works from Windows too)
```

## Tasks

| Command | What it does |
| --- | --- |
| `task dev` | `wails dev` |
| `task build` | `wails build` for this OS, default server `https://api.ghostman.uz` |
| `task build:linux` | Linux amd64 binary `build/bin/ghostman-linux-amd64`, built in Docker (`build/linux/Dockerfile`) — from Windows or Linux |
| `task build:linux:native` | the same on a Linux host with `libgtk-3-dev` + `libwebkit2gtk-4.1-dev` |
| `task test` | `go test ./...` + frontend unit tests (vitest) |
| `task lint` | `golangci-lint run ./...` |
| `task frontend:check` | `tsc --noEmit` in `frontend/` (installs deps first if needed) |
| `task sqlc` | regenerate Go from `internal/store/queries/*.sql` (schema = migrations dir) |
| `task migrate:create -- <name>` | new goose SQL migration in `internal/store/migrations/` |

Migrations are embedded in the binary and applied automatically at startup.

**Linux builds from Windows:** Wails v2 cannot cross-compile to Linux (the app links
WebKitGTK through cgo), so `task build:linux` builds inside a Linux container instead. Linux
`node_modules` and Go caches live in Docker volumes, so your Windows `node_modules` are untouched.
The binary needs WebKitGTK 4.1 at runtime (`libwebkit2gtk-4.1-0`: Ubuntu 22.04+, Debian 12+,
Fedora 39+).

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

## History and secrets

History is **local only**: it lives in the SQLite file above and is never sent to the server or
synced. Each entry stores the request twice: in **template** form (as authored, `{{vars}}`
unresolved) and in **resolved** form (as sent). The resolved form **includes secret variable
values on purpose** — it is what was actually sent, which is what you need when debugging. So
the database file holds secrets in plain text; treat it like any local credential store.
To remove them: Settings → History → Clear (the space is freed on disk right away). Logs never
contain resolved URLs, headers or secret values.

Retention (Settings → History): at most 100 / 500 / **1,000** / 5,000 entries or unlimited
(oldest pruned after each send), and responses stored up to 1 MB / **10 MB** / 50 MB or whole
(bigger ones keep their first part, marked truncated). A response is held in memory up to
max(20 MB, that setting) while it downloads; with **Unlimited**, a huge response is held in
memory completely.

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
