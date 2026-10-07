package main

import (
	"context"
	"log/slog"
	"net/http"

	"ghostman/internal/api"
	"ghostman/internal/session"
)

// Follow redirects is a cascading setting: requests and folders store
// inherit | global | on | off on the SERVER (shared with the team); the global
// value is local to this machine (Settings). The UI resolves the effective value
// (frontend/src/settingsResolver.ts) and passes it to SendRequest.

// GetFollowRedirectsDefault is the global setting (true unless turned off). Local.
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

// SetFollowRedirectsDefault saves the global setting. Local.
func (a *App) SetFollowRedirectsDefault(follow bool) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.SetFollowRedirectsDefault(a.ctx, follow); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}

func invalidToggle() *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Message: `follow_redirects must be "inherit", "global", "on" or "off"`}
}

// SetRequestFollowRedirects sets a request's follow_redirects on the server.
func (a *App) SetRequestFollowRedirects(id, value string) RequestResult {
	if !api.ValidToggle(value) {
		return RequestResult{Error: invalidToggle()}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) {
		return c.UpdateRequest(ctx, id, api.RequestPatch{FollowRedirects: &value})
	})
	return RequestResult{Data: ptr(v, p), Error: p}
}

// SetFolderFollowRedirects sets a folder's follow_redirects on the server.
func (a *App) SetFolderFollowRedirects(id, value string) FolderResult {
	if !api.ValidToggle(value) {
		return FolderResult{Error: invalidToggle()}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.FolderDetail, error) {
		return c.SetFolderFollowRedirects(ctx, id, value)
	})
	return FolderResult{Data: ptr(v, p), Error: p}
}

// LegacyMigration reports the one-time push of old local per-request overrides.
type LegacyMigration struct {
	Pushed    int `json:"pushed"`    // PATCHed to the server
	Dropped   int `json:"dropped"`   // request gone / no access: nothing to push
	Remaining int `json:"remaining"` // left for the next run (server unreachable, ...)
}

// legacyValue maps an old local override to the server value: the old
// "Always" (1) → on, "Never" (0) → off. The old "use default" had no row; the
// server's default for those requests is already "inherit".
func legacyValue(follow bool) string {
	if follow {
		return api.SettingOn
	}
	return api.SettingOff
}

// MigrateLegacyRequestSettings pushes the old local request_settings rows to
// the server once, then drops the table. Each row is deleted right after its
// PATCH succeeds, so an interrupted run just resumes (re-PATCHing is harmless).
// Rows whose request is gone or not accessible (404/403) are dropped; any other
// failure stops the run and keeps the rest for next time — including a 400: the
// ids are real request ids, so a 400 means a server that does not know
// follow_redirects yet (an older build), and the overrides must survive until
// the server is updated.
func (a *App) MigrateLegacyRequestSettings() LegacyMigration {
	var out LegacyMigration
	if a.store == nil || !a.session.IsLoggedIn() {
		return out
	}
	rows, err := a.store.LegacyRequestSettings(a.ctx)
	if err != nil {
		slog.Warn("read legacy request settings", "err", err)
		return out
	}
	for i, r := range rows {
		value := legacyValue(r.Follow)
		_, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) {
			return c.UpdateRequest(ctx, r.RequestID, api.RequestPatch{FollowRedirects: &value})
		})
		switch {
		case p == nil:
			out.Pushed++
		case p.Kind == session.KindServer && (p.Status == http.StatusNotFound || p.Status == http.StatusForbidden):
			out.Dropped++
		default:
			out.Remaining = len(rows) - i
			slog.Warn("push legacy request setting; will retry", "remaining", out.Remaining, "err", p.Message)
			return out
		}
		if err := a.store.DoneLegacyRequestSetting(a.ctx, r.RequestID); err != nil {
			slog.Warn("forget pushed request setting", "err", err)
		}
	}
	if err := a.store.DropLegacyRequestSettings(a.ctx); err != nil {
		slog.Warn("drop request_settings", "err", err)
	} else if len(rows) > 0 {
		slog.Info("pushed local request settings to the server", "pushed", out.Pushed, "dropped", out.Dropped)
	}
	return out
}
