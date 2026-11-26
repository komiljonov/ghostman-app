package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"

	"ghostman/internal/api"
	"ghostman/internal/pathsweep"
)

// Retired path variables: a one-time sweep per project rewrites ":key" URL
// segments into {{variables}} (rules: internal/pathsweep). It runs inside the
// workspace load / project switch, BEFORE the UI fetches the tree or restores
// tabs, so nothing open holds the old URL. The server no longer keeps the
// path_params rows; the values come from this machine's history (migration
// 00014 cached them), else the empty-value rule ({{key}}).
//
// Done = every rewrite was saved (404 / 403 = the request is gone or not ours:
// skipped); then the project is marked swept. Any other failure leaves it
// unmarked, so the next load retries — the rewrite is idempotent.

const settingPathSweptPrefix = "path_vars_swept_" // + project id → "1"

// sweepMu serializes sweeps: the UI issues workspace calls in parallel at
// startup, and each must see the flag the first one sets (no duplicate PATCHes).
var sweepMu sync.Mutex

// sweepClient is the part of *api.APIClient the sweep needs.
type sweepClient interface {
	ListRequests(ctx context.Context, projectID string) ([]api.RequestSummary, error)
	UpdateRequest(ctx context.Context, id string, patch api.RequestPatch) (api.Request, error)
}

func (a *App) sweepPathVariables(ctx context.Context, c sweepClient, projectID string) {
	if a.store == nil || projectID == "" {
		return
	}
	sweepMu.Lock()
	defer sweepMu.Unlock()
	if v, _ := a.setting(settingPathSweptPrefix + projectID); v == "1" {
		return
	}
	n, err := sweepProject(ctx, c, a.cachedPathValues(ctx, projectID), projectID)
	if err != nil {
		slog.Warn("path variable sweep: will retry on the next load", "project", projectID, "rewritten", n, "err", err)
		return
	}
	if n > 0 {
		slog.Info("path variable sweep: URLs rewritten", "project", projectID, "requests", n)
	}
	a.putSetting(settingPathSweptPrefix+projectID, "1")
}

// sweepProject rewrites every request URL of the project that still has ":key"
// segments; returns how many were saved and the first failure (others continue).
func sweepProject(ctx context.Context, c sweepClient, cached map[string]map[string]string, projectID string) (int, error) {
	reqs, err := c.ListRequests(ctx, projectID)
	if err != nil {
		return 0, err
	}
	saved := 0
	var first error
	for _, r := range reqs {
		next, changed := pathsweep.Rewrite(r.URL, cached[r.ID])
		if !changed {
			continue
		}
		if _, err := c.UpdateRequest(ctx, r.ID, api.RequestPatch{URL: &next}); err != nil {
			var apiErr *api.APIError
			if errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 403) {
				continue
			}
			if first == nil {
				first = err
			}
			continue
		}
		saved++
	}
	return saved, first
}

// cachedPathValues: per request id, the newest path_params rows this machine's
// history holds (key → value).
func (a *App) cachedPathValues(ctx context.Context, projectID string) map[string]map[string]string {
	rows, err := a.store.CachedPathParams(ctx, sql.NullString{String: projectID, Valid: true})
	if err != nil {
		slog.Warn("path variable sweep: history cache unreadable", "err", err)
		return nil
	}
	out := map[string]map[string]string{}
	for _, r := range rows {
		id := r.RequestID.String
		if _, done := out[id]; done {
			continue // newest first: the first row per request wins
		}
		var params []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}
		if json.Unmarshal([]byte(r.ReqPathParamsJson.String), &params) != nil {
			continue
		}
		m := map[string]string{}
		for _, p := range params {
			m[p.Key] = p.Value
		}
		out[id] = m
	}
	return out
}
