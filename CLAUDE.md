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
  Never log secret values; logs keep the unresolved `{{template}}` URL. Exception, on purpose:
  local history rows also store the RESOLVED request (secrets included) — local only, never
  synced, documented in README "History and secrets".

## UI layout (the standard — new features must fit into it)

Postman-style shell, logged in:

- **Top bar**, left to right: "Ghostman" · **Team switcher** (my teams with owner badge and
  member count, "+ New team", "Team settings") · **Project switcher** (accessible projects of
  the current team in sort order, "+ New project", "Project settings") · refresh (↻) · on the
  right the **env switcher** and then the **profile badge** (initials) whose menu holds user
  name/email, Invitations (count badge), History, Settings (server URL modal), Log out.
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
  Params | Headers | Body | Auth | Settings | History with the save status at the row's right end; response below a
  draggable divider), `env` (that environment's variables table), `env_list`
  (create / rename / reorder / delete environments) and `history` (see History). There is no separate environments page.
- **Editor groups** (VS Code style; pure rules in `src/layoutTree.ts` and `src/dropZone.ts`,
  both unit tested): the main pane is a split tree — `SplitNode{direction, children, sizes}` /
  `GroupNode{tabs, activeTabId}`. Every tab is in exactly one group; exactly one group is
  focused (it receives opens from the tree, shortcuts and Ctrl+Tab). Each op normalizes the
  tree: an emptied group is removed, a single-child split collapses, a same-direction child is
  flattened, and the freed space goes to the siblings in proportion. Groups and sashes are FLAT,
  absolutely positioned siblings (`layoutRects`), keyed by id, so a split, move or collapse never
  remounts another group's editors. **Sashes** (`GroupSash.tsx`): minimum 200×120 px per group
  (clamped while dragging; `fitTo` lifts a group below the minimum for the current window,
  display-only, never saved); double-click → equal sizes. **Tab drag & drop**
  (`EditorGroups.tsx`): a press becomes a drag after 5 px; rects are captured at drag start and
  hit-tested once per frame. Over a tab bar → insertion line (reorder, or move at that index);
  over a group's content → 5 zones (outer 33 % of each side splits there, the centre appends +
  activates), previewed by ONE overlay that fades in (150 ms) and animates between zones. No-ops
  give no preview: own centre, onto itself, a group's sole tab on its own edge (the same
  layout). Escape or a drop outside any target cancels. New groups grow in from their side and
  sizes animate (200 ms); off under `prefers-reduced-motion`. Tab menu: Close / Close Others /
  Close All (this group), Split Right / Split Down, Move to Group N.
- **Tabs and layout persistence** (`src/layoutPersistence.ts`, `layout.go`): per user + project,
  versioned JSON (`ui_layout_<user_id>_<project_id>`, `GetLayout`/`SetLayout`, version 1, ≤256 KB),
  saved 300 ms after a change and flushed on quit/project switch. On restore the JSON is
  validated (`parseLayout`: unknown version or corrupt → one fresh group; duplicate tabs → first
  wins; sizes repaired) and gone targets are dropped silently (rewritten once). The old
  `ui_tabs_<project_id>` list is migrated into one group. `SetLayout` also frees the Go-side
  bodies of request tabs no longer open. Tree renames/deletes relabel/close request tabs;
  environment renames/deletes relabel/close env tabs. Middle-click or × closes; tabs close one
  at a time through the normal close, so each flushes its pending save.
- **Shortcuts** (one action table, `shortcutAction` in `src/tabModel.ts`): Ctrl/Cmd+Enter sends,
  Ctrl+Tab / Ctrl+Shift+Tab cycle the FOCUSED group's tabs in bar order (wrapping), Ctrl/Cmd+W
  closes its active tab, Ctrl/Cmd+\ splits it right (no-op on a group's sole tab), Ctrl/Cmd+1..9
  focuses group N (reading order). Two entry points, both calling `shortcuts.runShortcut()`: one window keydown handler
  (bubble phase, skips events CodeMirror already handled) and a `Prec.highest` CodeMirror
  keymap. Both `preventDefault`, which is enough for WebView2: Ctrl+W never closes or blanks
  the window (verified with real OS keystrokes in `wails dev` and a built exe), so no Wails
  accelerator is needed. Ignored with a modal open or outside the tabs pane; Send is also
  ignored on env tabs or while that tab is sending — no queueing; Ctrl+W with no tabs is a no-op.
- **Bulk edit** (format: `src/bulkEdit.ts`, round-trip tested): Params, Headers and form fields
  are `KeyValueEditor`s — the table or ONE multi-line editor from the shared factory ({{var}}
  highlight / hover / completion), switched by a fixed-width, right-aligned toggle in a bar
  that exists in both views. Postman format: `key:value` per line, value = everything after
  the FIRST colon verbatim (JSON blobs survive), `//key:value` = disabled, no colon = empty
  value, blank lines ignored, key trimmed / value not. The rows stay the only data: every
  edit is parsed straight back into rows (same autosave); outside changes (URL bar) rewrite
  the text only when it no longer means the rows (`textMeansRows`). The view is a GLOBAL
  preference per kind (settings `ui_bulk_mode_params|headers|form`, `SetBulkMode`, `GetUIPrefs`).
  **Ctrl/Cmd+/** (bulk editors ONLY; `toggleBulkLines` in `src/codemirror.ts`, test matrix in
  `bulkToggle.test.ts`) toggles the `//` disable prefix = the rows' enable checkbox: cursor line
  or every touched line, one direction for all (any enabled → prefix those; else remove `//`
  and one space), blank lines skipped, selection mapped, `//` inserted before the key (column 0
  unless indented) so it is an exact inverse. NOT CodeMirror's toggleComment: it would
  double-prefix an already-disabled line, which the grammar reads as a key starting with `//`.
  One Mod-/ binding in the shared factory (above basicSetup's): gated by the `bulkEditor` facet
  and a closed completion popup; everywhere else (raw body, URL bar, cells, auth) it is
  swallowed as a no-op. Disabled lines are dimmed (`.cm-bulk-disabled`).
- **Format JSON** in the raw body (Go: `internal/jsonfmt`, bound `FormatJSONBody`; editor side:
  `src/bodyFormat.ts` + `formatTransaction` / `bodyFormatter` in `src/codemirror.ts`, both tested).
  Ctrl/Cmd+Shift+F in the raw body editor, or the **Format** button at the right end of the body
  toolbar (always present; disabled with a reason unless raw + a content type containing "json"
  + a non-blank body). Go masks every `{{token}}` OUTSIDE string literals (a string-aware scanner,
  the `engine.FindTokens` grammar; values, array items and object keys) with a JSON string
  placeholder whose prefix provably occurs nowhere in the input, runs `json.Indent` (2 spaces —
  re-indents without decoding, so numbers, key order, duplicate keys and escapes stay as
  written), restores the tokens verbatim and keeps the input's trailing whitespace. Tokens inside
  strings are already JSON and untouched. The editor applies the result as whitespace-only
  changes in ONE transaction (`isolateHistory`: one Ctrl+Z restores the exact text; the cursor
  maps through). Invalid JSON changes nothing: a muted one-line hint left of the button
  ("can't format: line L, col C: …", full text in its tooltip) until the next edit. The key is a
  swallowed no-op without a formatter (non-JSON body, bulk editors) or with the completion popup
  open; single-line editors don't bind it.
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
  are pushed by `MigrateLegacyRequestSettings` on the first logged-in load — ONE attempt, no
  retries: 404/403 rows are skipped, any other failure is shown as a dismissible banner, and the
  table is dropped either way. Server/app version mismatches are not handled in the client: the
  error is shown, and the fix is updating the server or the app. **Per-hop timing** (`internal/engine/trace.go`, httptrace): every hop records
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
  (collapsible) or truncated JSON (flat text + "structure view unavailable" notice); **Preview for `text/html`**, rendered in an
  iframe with an **empty `sandbox`** (no scripts, opaque origin), `srcdoc` = the truncated
  body, `referrerpolicy=no-referrer`, white page in both themes (absolute URLs load, relative
  ones break — accepted). A new response resets the view (Preview for HTML, Pretty for JSON,
  else Raw); Wrap is global (`ui_response_wrap`).
  **Media responses** (Go `Response.media`: image / audio / video / pdf / binary — never sent as
  text): Pretty/Raw disabled ("Not a text response — see Preview"); Preview is enabled and the
  default and renders `MediaPreview` (shared with history): the tab's held full body streamed
  from `/response-media/{tab}?v=N` (a new version per response; 404 once released) for image /
  audio / video, a file card with Save for pdf / binary.
- **Response filter (jq)** (`internal/filter`: gojq; bound methods in `response_filter.go`; rules
  in `src/responseFilter.ts`, unit tested; one component `ResponseFilterBar` for the live pane
  and the history detail). Its own row under the response toolbar, ALWAYS present, disabled
  ("JSON responses only") for anything else; a one-line hint row below it (note / quiet error /
  nothing) keeps the height fixed. Go runs the query over the FULL held body (tab: the active
  response; history: the stored body), parsed ONCE (`parsedDoc`: per tab on the held body, so a
  new send invalidates it; one history entry cached incl. its row) and warmed in the background
  when the input gets focus (`WarmResponseFilter` / `WarmHistoryFilter`); 1 s timeout ("filter
  timed out"); no output → "no matches", one → that value (a string as plain text), several →
  a JSON array; pretty (jq key order), the display copy capped so its JSON-ENCODED size is
  ≤ 256 KB (+ note "N results · X of Y"). Copy / Save filtered use the whole result Go-side
  (`CopyFilteredResult` via the runtime clipboard, `SaveFilteredResponseToFile`, history
  variants). UI: 300 ms debounce, Enter now, stale answers dropped (`createFilterRunner`); an
  error keeps the last good result (muted italic hint, never alarming); ✕ / Esc shows the full
  body instantly and KEEPS the query (Enter or editing re-applies); the result replaces the
  body in Pretty/Raw (collapse + search work in it); the save icon offers Full body | Filtered
  result while a result shows. The query is `response_filter` on the request (server, synced,
  literal — no {{vars}}), saved by the autosave; a new response auto-applies a saved filter
  (`shouldAutoApply`); the history detail starts empty. The ? popover holds 6 examples (click to use) and links to the
  jq manual / tutorial (`FILTER_DOCS`, opened with the runtime's `BrowserOpenURL`).
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
  keeps whatever expansion navigation produced. The open search (query, Aa, selected match) is kept per tab
  (`responseSearch`, like `responseFolds`) and restored when the body mounts again — switching tabs
  or Preview ↔ Pretty/Raw keeps it; closing it clears it. **Ctrl/Cmd+F rule** (`responseFindTarget`): the request body
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
- **`{{var}}` autocompletion** (rules: `src/varComplete.ts`, unit tested; glue: `varCompletion()` in
  `src/codemirror.ts`, added once in the shared factory, so the URL bar, raw body, table cells and
  auth fields all get it). The source answers ONLY inside an unclosed `{{partial` on the cursor's
  line ("{{" opens it at once; Ctrl+Space works there; anywhere else nothing pops); it re-runs on
  every keystroke (no `validFor`), so typing `}}` closes it; Escape closes, text stays. Options =
  every KEY of the project's environments, merged by key: **available** (in the active env:
  value preview ~30 chars, secrets a lock and no preview) always above **unavailable** (only in
  other envs, or no active env: dimmed `--var-unavailable`, env hint "in prod, staging +N",
  selectable); inside a group prefix before substring, then alphabetical (case-insensitive,
  inserted with its real case); `filter: false` keeps that order. A project without variables
  shows the disabled "No variables in this project" line. Accept inserts `KEY}}` (or only the
  key when `}}` already follows — the rest of an old key up to it is replaced) and puts the
  cursor past the braces. Data: `EnvContext.keys` (Go `envs.WithKeys`, bound context calls
  only: every env's keys + types + env names, values dropped in Go) in the env store snapshot —
  no bridge call per keystroke. **Keys**: in line editors Enter/Tab accept while a completion is
  active and are swallowed while it is pending (`enterAction`), so Enter never sends and Tab
  never leaves the field mid-completion; with no completion they Send / move focus.
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
- **History** (local only, `history.go` + `internal/store/history.go`): Go writes one row at the
  end of every send (success or failure) from what it already has — template form (draft rows,
  body), resolved form (`engine.SentURL/SentHeaders/SentBody`), env id/name, response headers,
  body up to `history_max_response_bytes` (+ `resp_truncated`), size, error, hops. No extra
  bridge traffic. Settings keys `history_max_entries` (100/500/1000/5000/0, default 1000;
  pruned after every insert and when lowered — the UI asks "delete M oldest?" first) and
  `history_max_response_bytes` (1/10/50 MB or 0, default 10 MB); the engine's Go-side body cap
  is max(20 MB, setting), uncapped for 0. Deletes run `ReclaimSpace` (incremental_vacuum +
  TRUNCATE checkpoint; auto_vacuum INCREMENTAL since migration 00007) so the file shrinks.
  The History tab (typed tab `history`, profile menu → History; rules in `src/historyModel.ts`)
  lists SUMMARY columns only (`ListHistory`: filters in SQL, keyset pages of 100); the full
  entry (`GetHistoryEntry`, 256 KB body preview) is fetched on select. Detail: Template |
  Resolved, response (the shared viewer), timing; actions Restore to new request (project root,
  template form, `api.CreateRequestFrom`), Open original (disabled when gone from the tree),
  Copy resolved URL, Delete. `src/historyStore.ts` ticks after sends/clears so an open list
  re-fetches. The request editor's **History sub-tab** (`RequestHistoryPanel`) lists that
  request's sends (`ListHistory` with `request_id`, index from migration 00008); a row or
  "Open in History" opens the History tab filtered to the request (removable "Request: X"
  chip) with that entry selected, via `focusHistory` (consumed once).
  **Media responses** are stored like every body (bytes, any type). `engine.MediaKind`
  (Content-Type, else UTF-8 sniff) marks image / audio / video / pdf / binary; such a body is
  NEVER sent to the UI as text (Pretty/Raw/Wrap disabled with a reason). Images, audio and
  video load from the app-local route `/history-media/{id}` (`history_media.go`, an
  assetserver Middleware: dev and built apps; only those kinds, stored type, nosniff,
  no-store, sandbox CSP, Range via ServeContent), so `<img>/<audio>/<video>` stream from
  SQLite and nothing crosses the bridge; PDF / binary show a file card. Every entry with a
  response has **Save response…** (`SaveHistoryResponseToFile`: native dialog, name +
  extension by type incl. png/jpg/svg/mp3/mp4/pdf, the stored bytes).
- **Authorization** (a cascading setting WITHOUT a global level): requests and folders store
  `auth` = {type inherit | none | bearer | basic | api_key, bearer_token, basic_username,
  basic_password, api_key_name, api_key_value, api_key_in header|query} **on the server**; values
  may hold `{{vars}}` (a secret var is the recommended way — literal text is synced to the team).
  Fields not matching the type are KEPT (server and UI; a mode switch changes only `type`).
  **Resolver** `resolveAuth` (`src/settingsResolver.ts`): bearer/basic/api_key at a level → that
  node's full config, stop; `none` → no auth, stop (source = that node); `inherit` → next folder;
  past the root → no auth (source "default", "nothing set in parents"). A request tab resolves
  its DRAFT's own config + its folders from the tree store (`effectiveAuthOf`), so labels follow
  edits, folder changes and moves live. UI: the **Auth sub-tab** and the folder **Settings…**
  modal share `AuthEditor` (mode select whose Inherit option names what it resolves to;
  fields are `VarField`s — standalone single-line CM editors from the shared factory; the
  basic password is masked (literal text as bullets, `{{vars}}` visible) with a reveal toggle).
  Request auth rides the autosave (`api.BuildAuthPatch`: type + the changed fields); the folder
  modal saves auth + follow_redirects in ONE PATCH (`SaveFolderSettings`). Sub-tab dots: Auth
  when type ≠ inherit, Settings when follow ≠ inherit (`overridesSomething`). **Send**: TS passes
  the effective config (template form) + source in `SendOptions.auth`; Go resolves `{{vars}}`
  inside it (same env map, secret overlay, unresolved keys join the banner) and
  `engine.ApplyAuth` adds ONE derived row: `Authorization: Bearer …` / `Basic base64(u:p)` /
  the API key header, or `name=value` appended to the query. **User-written wins**: an enabled
  header with the same name (case-insensitive), or the same query param in the rows or the URL,
  means nothing is added. Being a plain header, a derived Authorization follows the cross-host
  redirect drop rule. History: the resolved copy has the derived header/param; `req_auth_json`
  (migration 00009) keeps the config as authored + its source; Restore sets that effective
  config explicitly on the new root request.
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
                         GetTabs/SetTabs (legacy tab list), quit handshake
layout.go                bound editor-group layout per user + project (GetLayout/SetLayout, migration)
history.go               history write path (recordHistory) + bound history methods (list, entry,
                         delete, clear, storage info, retention settings, restore)
history_media.go         /history-media/{id} + /response-media/{tab} media routes; SaveHistoryResponseToFile
response_filter.go       jq filter bar: Eval/Copy/Save(Response|History)Filter…, parsed-body caches, warm-up
environments.go          bound environment/variable methods + local secret access
theme.go                 bound theme preference (GetTheme/SetTheme, local settings)
uiprefs.go               bound layout prefs (GetUIPrefs, SetSidebarWidth, SetResponseWrap)
responses.go             full response bodies per tab (Go-side), SaveResponseToFile, ReleaseResponse
body_format.go           bound FormatJSONBody (raw body Format; rules in internal/jsonfmt)
redirects.go             follow-redirects: local global value, node setters (server), SaveFolderSettings
                         (folder auth + follow in one PATCH), legacy local→server push
ui_tokens_test.go        fails on color literals outside frontend/src/tokens.css
internal/engine/         HTTP request engine (the product core)
internal/api/            typed client for the Ghostman server API (/api/v1)
internal/session/        server URL resolution, auth state machine, login/logout/settings
internal/workspace/      current team/project selection: persist, validate, fall back
internal/envs/           environments: active env, variables with local-only secrets, var map
internal/jsonfmt/        Format JSON for template bodies: mask {{vars}} outside strings, indent, restore
internal/filter/         jq (gojq) evaluation for the response filter bar: parse once, cap, note
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

- Variable usage search; env duplication;
  dynamic/generated variables.
- More cascading settings through the same resolver (proxy, timeout, TLS / insecure);
  the Settings sub-tab and the folder Settings… modal are their home. Auth: OAuth 2.0, digest.
- Response search: regex mode.
- Comments in the raw (JSON) body via Ctrl+/: deliberately NOT supported — comments would be
  sent verbatim and break APIs. Revisit only with an opt-in strip-on-send.
- Cookies; multipart/file bodies; history export / sync.
- **Drag-and-drop for the project list**: for now projects use ↑/↓ in Project settings. Reorder
  endpoints need the full sibling set (every team project, so only the team owner and
  all-projects members get ↑/↓).
