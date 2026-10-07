package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
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
}

// SendRequest executes a tab's current draft with {{vars}} resolved from the
// project's active environment (local secret values included). A send already
// running for the same request is cancelled first. Every send is recorded in local
// history (history.go); logs keep the unresolved template URL only.
func (a *App) SendRequest(projectID, requestID string, draft api.RequestDraft, opts SendOptions) SendResult {
	if !a.session.IsLoggedIn() {
		return SendResult{Error: problemNotLoggedIn, Unresolved: []string{}}
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
		return SendResult{Error: p, Unresolved: []string{}}
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

	template := specFromDraft(draft)
	spec, unresolved := engine.ResolveSpec(template, rv.vars)
	if unresolved == nil {
		unresolved = []string{}
	}
	start := time.Now()
	bodyCap := int64(0)
	if a.store != nil {
		bodyCap = historyBodyCap(a.store.HistoryLimits(a.ctx))
	}
	resp, err := a.engine.Send(ctx, spec, engine.SendOptions{FollowRedirects: opts.FollowRedirects, FullBodyCap: bodyCap})
	a.recordHistory(historyRecord{
		projectID: projectID, requestID: requestID, requestName: opts.RequestName,
		envID: rv.envID, envName: rv.env, draft: draft, template: template, resolved: spec,
		resp: resp, err: err, start: start,
	})
	// The tab's active response (full body, Go-side) — unless a newer send of the
	// same request has taken over meanwhile.
	a.sendsMu.Lock()
	if a.sends[requestID] == mine {
		if err == nil {
			a.responses.put(requestID, heldBody{projectID: projectID, data: resp.Full, capped: resp.FullCapped, contentType: resp.ContentType})
		} else {
			a.responses.release(requestID)
		}
	}
	a.sendsMu.Unlock()
	if err != nil {
		return SendResult{
			Error: &session.Problem{Kind: KindRequest, Message: err.Error()}, Unresolved: unresolved, Environment: rv.env,
			Hops: maskSecrets(nonNilHops(engine.HopsOf(err)), rv.secrets),
		}
	}
	resp.Hops = maskSecrets(nonNilHops(resp.Hops), rv.secrets)
	return SendResult{Data: resp, Unresolved: unresolved, Environment: rv.env, Hops: resp.Hops}
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
