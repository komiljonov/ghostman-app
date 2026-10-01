package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/session"
	"ghostman/internal/store"
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
}

// Tabs is a project's open request tabs (ids only) and the active one.
type Tabs struct {
	Open   []string `json:"open"`
	Active string   `json:"active"`
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

// SendRequest executes a tab's current draft with {{vars}} resolved from the
// project's active environment (local secret values included). A send already
// running for the same request is cancelled first. Every send is recorded in local
// history — with the unresolved template URL, so secrets never land in history or logs.
func (a *App) SendRequest(projectID, requestID string, draft api.RequestDraft) SendResult {
	if !a.session.IsLoggedIn() {
		return SendResult{Error: problemNotLoggedIn, Unresolved: []string{}}
	}
	// Variables are read fresh from the server for every send (online-only), with
	// this machine's secret values overlaid.
	type resolved struct {
		vars map[string]string
		env  string
	}
	rv, p := call(a, func(ctx context.Context, c *api.APIClient) (resolved, error) {
		m, ec, err := a.envs.VarMap(ctx, c, projectID)
		return resolved{m, ec.ActiveName}, err
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
	resp, err := a.engine.SendRequest(ctx, spec)
	a.recordHistory(template, resp, err, start)
	if err != nil {
		return SendResult{Error: &session.Problem{Kind: KindRequest, Message: err.Error()}, Unresolved: unresolved, Environment: rv.env}
	}
	return SendResult{Data: resp, Unresolved: unresolved, Environment: rv.env}
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

func (a *App) recordHistory(spec engine.RequestSpec, resp *engine.Response, err error, start time.Time) {
	entry := store.InsertHistoryParams{
		Method:    strings.ToUpper(strings.TrimSpace(spec.Method)),
		Url:       strings.TrimSpace(spec.URL),
		CreatedAt: start.UnixMilli(),
	}
	if err != nil {
		entry.DurationMs = time.Since(start).Milliseconds()
		slog.Info("request failed", "method", entry.Method, "url", entry.Url, "err", err)
	} else {
		entry.Status = int64(resp.Status)
		entry.DurationMs = resp.DurationMs
		slog.Info("request sent", "method", entry.Method, "url", entry.Url, "status", resp.Status, "duration_ms", resp.DurationMs)
	}
	if entry.Url == "" || a.store == nil {
		return
	}
	// History is best-effort: a DB problem must not hide the response.
	if herr := a.store.InsertHistory(a.ctx, entry); herr != nil {
		slog.Error("record history", "err", herr)
	}
}

func tabsKey(projectID string) string { return "ui_tabs_" + projectID }

// GetTabs returns a project's open tabs (local UI state).
func (a *App) GetTabs(projectID string) Tabs {
	tabs := Tabs{Open: []string{}}
	if a.store == nil || projectID == "" {
		return tabs
	}
	raw, ok, err := a.store.Setting(a.ctx, tabsKey(projectID))
	if err != nil || !ok {
		return tabs
	}
	if err := json.Unmarshal([]byte(raw), &tabs); err != nil {
		slog.Warn("ignoring corrupt tab state", "project", projectID, "err", err)
		return Tabs{Open: []string{}}
	}
	if tabs.Open == nil {
		tabs.Open = []string{}
	}
	return tabs
}

// SetTabs saves a project's open tabs (local UI state).
func (a *App) SetTabs(projectID string, tabs Tabs) EmptyResult {
	if a.store == nil || projectID == "" {
		return EmptyResult{}
	}
	if tabs.Open == nil {
		tabs.Open = []string{}
	}
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
