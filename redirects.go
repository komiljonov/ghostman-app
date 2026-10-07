package main

import (
	"context"
	"log/slog"

	"ghostman/internal/session"
)

// Follow-redirects settings, local to this machine (never synced): a global
// default (Settings modal) and an optional per-request override (the request's
// Settings sub-tab). Go resolves the effective value at send time.

// Per-request redirect modes.
const (
	RedirectsDefault = "default" // use the global default
	RedirectsAlways  = "always"
	RedirectsNever   = "never"
)

// RedirectSetting is a request's redirect setting as the UI shows it.
type RedirectSetting struct {
	Mode      string `json:"mode"`      // default | always | never
	Default   bool   `json:"default"`   // the global default
	Effective bool   `json:"effective"` // what a send will do
}

// followRedirects is the effective value for a send: override, else the default.
func (a *App) followRedirects(ctx context.Context, requestID string) bool {
	return a.redirectSetting(ctx, requestID).Effective
}

func (a *App) redirectSetting(ctx context.Context, requestID string) RedirectSetting {
	out := RedirectSetting{Mode: RedirectsDefault, Default: true, Effective: true}
	if a.store == nil {
		return out
	}
	def, err := a.store.FollowRedirectsDefault(ctx)
	if err != nil {
		slog.Warn("load follow-redirects default", "err", err)
	}
	out.Default, out.Effective = def, def
	override, err := a.store.FollowRedirectsOverride(ctx, requestID)
	if err != nil {
		slog.Warn("load follow-redirects override", "err", err)
		return out
	}
	if override != nil {
		out.Effective = *override
		out.Mode = RedirectsNever
		if *override {
			out.Mode = RedirectsAlways
		}
	}
	return out
}

// GetRequestRedirects returns a request's redirect setting (mode, default, effective).
func (a *App) GetRequestRedirects(requestID string) RedirectSetting {
	return a.redirectSetting(a.ctx, requestID)
}

// SetRequestRedirects sets a request's mode: "default" (use the global default),
// "always" or "never".
func (a *App) SetRequestRedirects(requestID, mode string) EmptyResult {
	var override *bool
	switch mode {
	case RedirectsDefault:
	case RedirectsAlways, RedirectsNever:
		v := mode == RedirectsAlways
		override = &v
	default:
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: `mode must be "default", "always" or "never"`}}
	}
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.SetFollowRedirectsOverride(a.ctx, requestID, override); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}

// GetFollowRedirectsDefault is the global default (true unless turned off).
func (a *App) GetFollowRedirectsDefault() bool {
	if a.store == nil {
		return true
	}
	def, err := a.store.FollowRedirectsDefault(a.ctx)
	if err != nil {
		slog.Warn("load follow-redirects default", "err", err)
	}
	return def
}

// SetFollowRedirectsDefault saves the global default.
func (a *App) SetFollowRedirectsDefault(follow bool) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.SetFollowRedirectsDefault(a.ctx, follow); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}
