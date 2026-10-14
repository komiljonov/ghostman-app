package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"maps"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/scripting"
	"ghostman/internal/session"
)

// Bound request-editor methods: autosave, send/cancel, and the open-tabs list.

// KindRequest marks a failure to send the user's request (bad URL, DNS, timeout,
// cancelled...). The message is already human-readable.
const KindRequest = "request"

// quitGrace bounds how long closing the window waits for the UI to flush saves.
const quitGrace = 3 * time.Second

// inflight is one running send; compared by pointer to tell sends apart.
type inflight struct {
	cancel context.CancelFunc
}

type SendResult struct {
	Data  *engine.Response `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
	// Unresolved lists {{keys}} that were sent literally (not in the active
	// environment, or secrets without a value on this machine).
	Unresolved []string `json:"unresolved"`
	// Environment is the active environment's name ("" = none).
	Environment string `json:"environment"`
	// Hops is the timing of every exchange (initial request + followed redirects),
	// also when the send failed (the failed hop last, with its phase).
	Hops []engine.Hop `json:"hops"`
	// Console is the send's script output (empty without scripts); a failed
	// pre-script is its last entry AND the Error.
	Console *scripting.Console `json:"console"`
}

// Tab kinds.
const (
	TabRequest = "request"
	TabEnv     = "env"
	TabEnvList = "env_list"
	TabHistory = "history"
)

// TabRef identifies an open tab: a request, an environment, or the environment list.
// An empty Kind means "none" (e.g. no active tab).
type TabRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// UnmarshalJSON also accepts the pre-typed format, a bare request id string.
func (t *TabRef) UnmarshalJSON(raw []byte) error {
	var id string
	if err := json.Unmarshal(raw, &id); err == nil {
		*t = TabRef{}
		if id != "" {
			*t = TabRef{Kind: TabRequest, ID: id}
		}
		return nil
	}
	type plain TabRef
	return json.Unmarshal(raw, (*plain)(t))
}

func (t TabRef) valid() bool {
	switch t.Kind {
	case TabRequest, TabEnv:
		return t.ID != ""
	case TabEnvList, TabHistory:
		return true
	}
	return false
}

// Tabs is a project's open tabs, in tab-bar order, and the active one.
type Tabs struct {
	Open   []TabRef `json:"open"`
	Active TabRef   `json:"active"`
}

// normalize drops unknown/invalid entries and duplicates, and an active tab that is not open.
func (t Tabs) normalize() Tabs {
	out := Tabs{Open: []TabRef{}}
	seen := map[TabRef]bool{}
	for _, ref := range t.Open {
		if ref.valid() && !seen[ref] {
			seen[ref] = true
			out.Open = append(out.Open, ref)
		}
	}
	if seen[t.Active] {
		out.Active = t.Active
	}
	return out
}

// SaveRequest autosaves a tab: it PATCHes only what differs between base (the
// last saved state) and draft. Nothing changed means no request and Data nil.
func (a *App) SaveRequest(id string, base, draft api.RequestDraft) RequestResult {
	if !api.ValidAuth(draft.Auth) {
		return RequestResult{Error: invalidAuth()}
	}
	patch, changed := api.BuildRequestPatch(base, draft)
	if !changed {
		return RequestResult{}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) {
		return c.UpdateRequest(ctx, id, patch)
	})
	return RequestResult{Data: ptr(v, p), Error: p}
}

// SendOptions are the per-send settings the UI resolves (the effective
// follow-redirects value) plus what history labels the entry with.
type SendOptions struct {
	FollowRedirects bool   `json:"follow_redirects"`
	RequestName     string `json:"request_name"`
	// Auth is the effective auth config from the cascade (request draft, then its
	// folders; settingsResolver.ts), still in template form; nil = no auth.
	// AuthSource names where it came from ("this request", "folder ‘api’", ...).
	Auth       *api.Auth `json:"auth"`
	AuthSource string    `json:"auth_source"`
	// Folders is the request's folder chain, OUTERMOST first, with their scripts
	// (scripts.go): they run around the request's own, outer first.
	Folders []ScriptFolder `json:"folders"`
}

// engineAuth converts the effective config for the engine (nil = nothing to add).
func engineAuth(a *api.Auth) *engine.Auth {
	if a == nil {
		return nil
	}
	n := api.NormalizeAuth(*a)
	return &engine.Auth{Type: n.Type, BearerToken: n.BearerToken, BasicUsername: n.BasicUsername, BasicPassword: n.BasicPassword,
		APIKeyName: n.APIKeyName, APIKeyValue: n.APIKeyValue, APIKeyIn: n.APIKeyIn}
}

// SendRequest executes a tab's current draft with {{vars}} resolved from the
// project's active environment (local secret values included). A send already
// running for the same request is cancelled first. Every send is recorded in local
// history (history.go); logs keep the unresolved template URL only.
func (a *App) SendRequest(projectID, requestID string, draft api.RequestDraft, opts SendOptions) SendResult {
	console := &scripting.Console{Entries: []scripting.Entry{}}
	if !a.session.IsLoggedIn() {
		return SendResult{Error: problemNotLoggedIn, Unresolved: []string{}, Console: console}
	}
	// Variables are read fresh from the server for every send (online-only), with
	// this machine's secret values overlaid.
	type resolved struct {
		vars    map[string]string
		env     string
		envID   string
		secrets []string // local secret values, masked in the hop URLs shown to the UI
	}
	rv, p := call(a, func(ctx context.Context, c *api.APIClient) (resolved, error) {
		m, ec, err := a.envs.VarMap(ctx, c, projectID)
		var secrets []string
		for _, v := range ec.Variables {
			if v.Type == api.VarSecret && v.HasValue && v.Value != "" {
				secrets = append(secrets, v.Value)
			}
		}
		return resolved{m, ec.ActiveName, ec.ActiveID, secrets}, err
	})
	if p != nil {
		p.Message = "could not load environment variables: " + p.Message
		return SendResult{Error: p, Unresolved: []string{}, Console: console}
	}

	ctx, cancel := context.WithCancel(a.ctx)
	mine := &inflight{cancel: cancel}
	a.sendsMu.Lock()
	if prev, ok := a.sends[requestID]; ok {
		prev.cancel()
	}
	a.sends[requestID] = mine
	a.sendsMu.Unlock()
	defer func() {
		cancel()
		a.sendsMu.Lock()
		// Only remove our own entry: a newer send may have replaced it.
		if a.sends[requestID] == mine {
			delete(a.sends, requestID)
		}
		a.sendsMu.Unlock()
	}()

	if opts.Auth != nil && !api.ValidAuth(*opts.Auth) {
		return SendResult{Error: invalidAuth(), Unresolved: []string{}, Console: console}
	}
	template := specFromDraft(draft)
	template.Auth = engineAuth(opts.Auth)
	a.attachFiles(requestID, &template) // multipart file fields: local paths (never synced)
	start := time.Now()

	// Scripts (internal/scripting). ORDER MATTERS: pre-scripts run on a COPY of the
	// template BEFORE {{var}} resolution, so gm.request mutations reach this send
	// only (the stored request is never modified) and gm.environment.set changes
	// THIS send's resolution — the token / signature use case. Env writes are
	// applied after each script (outside its time budget).
	preScripts, postScripts := gatherScripts(opts.Folders, draft, opts.RequestName)
	sent := cloneSpec(template)
	scriptEnv := &scripting.EnvState{Vars: maps.Clone(rv.vars)}
	if rv.envID != "" {
		scriptEnv.Name = rv.env
	}
	if scriptEnv.Vars == nil {
		scriptEnv.Vars = map[string]string{}
	}
	client := a.currentClient()
	runScript := func(s scripting.Script, resp *scripting.Response) error {
		if err := scripting.Run(ctx, s, &sent, resp, scriptEnv, console); err != nil {
			return err
		}
		written, err := a.flushEnv(ctx, client, rv.envID, scriptEnv)
		rv.secrets = append(rv.secrets, written...)
		if err != nil {
			if api.IsUnauthorized(err) {
				a.session.Check(a.ctx)
			}
			return &scripting.ScriptError{Owner: s.Owner, Phase: s.Phase, Message: "gm.environment: " + err.Error()}
		}
		return nil
	}
	for _, s := range preScripts {
		if err := runScript(s, nil); err != nil {
			console.Error(s.Owner, s.Phase, err.Error())
			a.recordHistory(historyRecord{
				projectID: projectID, requestID: requestID, requestName: opts.RequestName,
				envID: rv.envID, envName: rv.env, draft: draft, template: template, resolved: sent,
				auth: opts.Auth, authSource: opts.AuthSource, err: err, start: start, console: console,
			})
			return SendResult{Error: &session.Problem{Kind: KindRequest, Message: err.Error()}, Unresolved: []string{},
				Environment: rv.env, Hops: []engine.Hop{}, Console: console}
		}
	}

	// {{vars}} resolve inside the auth values too; the derived header / query param
	// is added at send (engine.ApplyAuth): user-written rows win.
	spec, unresolved := engine.ResolveSpec(sent, scriptEnv.Vars)
	if unresolved == nil {
		unresolved = []string{}
	}
	bodyCap := int64(0)
	if a.store != nil {
		bodyCap = historyBodyCap(a.store.HistoryLimits(a.ctx))
	}
	resp, err := a.engine.Send(ctx, spec, engine.SendOptions{FollowRedirects: opts.FollowRedirects, FullBodyCap: bodyCap})

	// Post-scripts see the response; a failing one is reported in the console and
	// never hides the response. Without a response (the send failed) they are skipped.
	if len(postScripts) > 0 {
		if err != nil {
			console.Error(postScripts[0].Owner, scripting.Post, "post-response scripts skipped: the send failed")
		} else {
			view := scriptResponse(resp)
			for _, s := range postScripts {
				if serr := runScript(s, view); serr != nil {
					console.Error(s.Owner, s.Phase, serr.Error())
				}
			}
		}
	}
	a.recordHistory(historyRecord{
		projectID: projectID, requestID: requestID, requestName: opts.RequestName,
		envID: rv.envID, envName: rv.env, draft: draft, template: template, resolved: spec,
		auth: opts.Auth, authSource: opts.AuthSource,
		resp: resp, err: err, start: start, console: console,
	})
	// The tab's active response (full body, Go-side) — unless a newer send of the
	// same request has taken over meanwhile.
	a.sendsMu.Lock()
	if a.sends[requestID] == mine {
		if err == nil {
			v := a.responses.put(requestID, heldBody{projectID: projectID, data: resp.Full, capped: resp.FullCapped, contentType: resp.ContentType})
			if servableMedia(resp.Media) && len(resp.Full) > 0 {
				resp.MediaURL = responseMediaURL(requestID, v) // Preview streams it (history_media.go)
			}
		} else {
			a.responses.release(requestID)
		}
	}
	a.sendsMu.Unlock()
	if err != nil {
		return SendResult{
			Error: &session.Problem{Kind: KindRequest, Message: err.Error()}, Unresolved: unresolved, Environment: rv.env,
			Hops: maskSecrets(nonNilHops(engine.HopsOf(err)), rv.secrets), Console: console,
		}
	}
	resp.Hops = maskSecrets(nonNilHops(resp.Hops), rv.secrets)
	return SendResult{Data: resp, Unresolved: unresolved, Environment: rv.env, Hops: resp.Hops, Console: console}
}

// CancelRequest cancels the in-flight send of a request, if any.
func (a *App) CancelRequest(requestID string) {
	a.sendsMu.Lock()
	defer a.sendsMu.Unlock()
	if s, ok := a.sends[requestID]; ok {
		s.cancel()
		delete(a.sends, requestID)
	}
}

// specFromDraft converts the editor's draft into what the engine sends.
func specFromDraft(d api.RequestDraft) engine.RequestSpec {
	parts := func(in []api.MultipartField) []engine.Part {
		out := make([]engine.Part, 0, len(in))
		for _, p := range in {
			out = append(out, engine.Part{Key: p.Key, Kind: p.Kind, Value: p.Value, FileName: p.FileName, Enabled: p.Enabled})
		}
		return out
	}
	rows := func(in []api.KeyValue) []engine.Header {
		out := make([]engine.Header, 0, len(in))
		for _, r := range in {
			out = append(out, engine.Header{Key: r.Key, Value: r.Value, Enabled: r.Enabled})
		}
		return out
	}
	return engine.RequestSpec{
		Method:      d.Method,
		URL:         d.URL,
		Headers:     rows(d.Headers),
		QueryParams: rows(d.QueryParams),
		Body: engine.Body{
			Type:        d.Body.Type,
			ContentType: d.Body.ContentType,
			Content:     d.Body.Content,
			Fields:      rows(d.Body.Fields),
			Parts:       parts(d.Body.Parts),
		},
	}
}

func tabsKey(projectID string) string { return "ui_tabs_" + projectID }

// GetTabs returns a project's open tabs (local UI state). The old format (bare
// request ids) is read as request tabs; anything unreadable gives no tabs.
func (a *App) GetTabs(projectID string) Tabs {
	tabs := Tabs{Open: []TabRef{}}
	if a.store == nil || projectID == "" {
		return tabs
	}
	raw, ok, err := a.store.Setting(a.ctx, tabsKey(projectID))
	if err != nil || !ok {
		return tabs
	}
	if err := json.Unmarshal([]byte(raw), &tabs); err != nil {
		slog.Warn("ignoring corrupt tab state", "project", projectID, "err", err)
		return Tabs{Open: []TabRef{}}
	}
	tabs = tabs.normalize()
	if isLegacyTabs(raw) {
		// Migrate the stored value once; if that fails, it is simply migrated again next time.
		if res := a.SetTabs(projectID, tabs); res.Error != nil {
			slog.Warn("migrate tab state", "project", projectID, "err", res.Error.Message)
		}
	}
	return tabs
}

// isLegacyTabs reports whether raw is the pre-typed format (bare request id strings).
func isLegacyTabs(raw string) bool {
	var probe struct {
		Open   []json.RawMessage `json:"open"`
		Active json.RawMessage   `json:"active"`
	}
	if json.Unmarshal([]byte(raw), &probe) != nil {
		return false
	}
	for _, e := range probe.Open {
		if len(e) > 0 && e[0] == '"' {
			return true
		}
	}
	return len(probe.Active) > 0 && probe.Active[0] == '"'
}

// SetTabs saves a project's open tabs (local UI state).
func (a *App) SetTabs(projectID string, tabs Tabs) EmptyResult {
	if a.store == nil || projectID == "" {
		return EmptyResult{}
	}
	tabs = tabs.normalize()
	// Closed request tabs (close / close others / close all) free their full bodies.
	open := map[string]bool{}
	for _, t := range tabs.Open {
		if t.Kind == TabRequest {
			open[t.ID] = true
		}
	}
	a.responses.keepOnly(projectID, open)
	raw, err := json.Marshal(tabs)
	if err == nil {
		err = a.store.PutSetting(a.ctx, tabsKey(projectID), string(raw))
	}
	if err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}

// beforeClose runs when the window is closing. The first time, it asks the UI to
// flush pending autosaves (the UI answers with ConfirmQuit) and keeps the window
// open; if the UI does not answer within quitGrace, the app quits anyway.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	a.quitMu.Lock()
	defer a.quitMu.Unlock()
	if a.quitting {
		return false
	}
	a.quitting = true
	runtime.EventsEmit(ctx, "app:before-close")
	time.AfterFunc(quitGrace, func() { runtime.Quit(ctx) })
	return true
}

// ConfirmQuit is called by the UI once pending saves are flushed.
func (a *App) ConfirmQuit() {
	runtime.Quit(a.ctx)
}

// maskSecrets hides local secret values (as typed, and as the engine encoded them
// into the URL) in the hop URLs: like everywhere else in the UI, a secret is only
// shown after an explicit Reveal.
func maskSecrets(hops []engine.Hop, secrets []string) []engine.Hop {
	if len(secrets) == 0 {
		return hops
	}
	// Longest first, so a secret containing another is masked whole.
	sort.Slice(secrets, func(i, j int) bool { return len(secrets[i]) > len(secrets[j]) })
	for i := range hops {
		for _, s := range secrets {
			for _, form := range []string{s, url.QueryEscape(s), url.PathEscape(s)} {
				hops[i].URL = strings.ReplaceAll(hops[i].URL, form, "••••")
			}
		}
	}
	return hops
}

func nonNilHops(h []engine.Hop) []engine.Hop {
	if h == nil {
		return []engine.Hop{}
	}
	return h
}
