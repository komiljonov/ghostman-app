package main

import (
	"context"
	"fmt"
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

func invalidAuth() *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Message: "auth type must be inherit, none, bearer, basic or api_key (API key in header or query)"}
}

// SaveFolderSettings saves a folder's cascading settings (Folder settings modal)
// in one PATCH: follow_redirects when it differs from the stored value, auth as
// type + the fields that changed between base (stored) and auth (edited).
// Nothing changed = no request.
func (a *App) SaveFolderSettings(id, storedFollow, follow string, base, auth api.Auth) FolderResult {
	if !api.ValidToggle(follow) {
		return FolderResult{Error: invalidToggle()}
	}
	if !api.ValidAuth(auth) {
		return FolderResult{Error: invalidAuth()}
	}
	var patch api.FolderSettingsPatch
	if follow != storedFollow {
		patch.FollowRedirects = &follow
	}
	patch.Auth, _ = api.BuildAuthPatch(base, auth)
	if patch.FollowRedirects == nil && patch.Auth == nil {
		return FolderResult{}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.FolderDetail, error) {
		return c.UpdateFolderSettings(ctx, id, patch)
	})
	return FolderResult{Data: ptr(v, p), Error: p}
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
	Pushed  int `json:"pushed"`  // PATCHed to the server
	Dropped int `json:"dropped"` // request gone / no access: nothing to push
	Failed  int `json:"failed"`  // the server refused or could not be reached
}

type LegacyMigrationResult struct {
	Data  LegacyMigration  `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
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
// the server ONCE, then drops the table — a single attempt, no retries. Rows
// whose request is gone or not accessible (404/403) are skipped silently; any
// other failure is reported as the result's error (the UI shows it) and those
// values are not kept.
func (a *App) MigrateLegacyRequestSettings() LegacyMigrationResult {
	var out LegacyMigrationResult
	if a.store == nil || !a.session.IsLoggedIn() {
		return out
	}
	rows, err := a.store.LegacyRequestSettings(a.ctx)
	if err != nil || len(rows) == 0 {
		if err != nil {
			slog.Warn("read legacy request settings", "err", err)
		}
		_ = a.store.DropLegacyRequestSettings(a.ctx)
		return out
	}
	var first *session.Problem
	for _, r := range rows {
		value := legacyValue(r.Follow)
		_, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) {
			return c.UpdateRequest(ctx, r.RequestID, api.RequestPatch{FollowRedirects: &value})
		})
		switch {
		case p == nil:
			out.Data.Pushed++
		case p.Kind == session.KindServer && (p.Status == http.StatusNotFound || p.Status == http.StatusForbidden):
			out.Data.Dropped++
		default:
			out.Data.Failed++
			if first == nil {
				first = p
			}
		}
	}
	if err := a.store.DropLegacyRequestSettings(a.ctx); err != nil {
		slog.Warn("drop request_settings", "err", err)
	}
	slog.Info("moved local request settings to the server", "pushed", out.Data.Pushed, "dropped", out.Data.Dropped, "failed", out.Data.Failed)
	if first != nil {
		out.Error = &session.Problem{
			Kind: first.Kind, Status: first.Status, Code: first.Code,
			Message: fmt.Sprintf("Could not move %d redirect setting(s) to the server: %s", out.Data.Failed, first.Message),
		}
	}
	return out
}
