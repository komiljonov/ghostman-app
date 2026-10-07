package main

import (
	"log/slog"
	"strconv"

	"ghostman/internal/session"
)

// Layout preferences (local UI state, no server involved).

const (
	settingSidebarWidth = "ui_sidebar_width"
	settingResponseWrap = "ui_response_wrap"
	// ui_bulk_mode_<kind>: whether that kind of key/value table (params, headers,
	// form) shows the bulk text view — global, not per request.
	settingBulkModePrefix = "ui_bulk_mode_"

	// DefaultSidebarWidth is the sidebar width in CSS px until the user drags it.
	DefaultSidebarWidth = 260
	// MinSidebarWidth is the narrowest sidebar. The upper bound (half the window)
	// depends on the window size, so the UI applies it; Go only refuses nonsense.
	MinSidebarWidth = 180
	maxSidebarWidth = 4000
)

// UIPrefs are the persisted layout preferences, read once on startup.
type UIPrefs struct {
	SidebarWidth int  `json:"sidebar_width"`
	ResponseWrap bool `json:"response_wrap"`
	BulkParams   bool `json:"bulk_params"`
	BulkHeaders  bool `json:"bulk_headers"`
	BulkForm     bool `json:"bulk_form"`
}

// bulkKinds are the tables with a bulk view.
var bulkKinds = map[string]bool{"params": true, "headers": true, "form": true}

// GetUIPrefs returns the layout preferences, with defaults for anything unset or corrupt.
func (a *App) GetUIPrefs() UIPrefs {
	prefs := UIPrefs{SidebarWidth: DefaultSidebarWidth, ResponseWrap: true}
	if a.store == nil {
		return prefs
	}
	if v, ok := a.setting(settingSidebarWidth); ok {
		if n, err := strconv.Atoi(v); err == nil && n >= MinSidebarWidth && n <= maxSidebarWidth {
			prefs.SidebarWidth = n
		}
	}
	if v, ok := a.setting(settingResponseWrap); ok {
		if b, err := strconv.ParseBool(v); err == nil {
			prefs.ResponseWrap = b
		}
	}
	bulk := func(kind string) bool {
		v, ok := a.setting(settingBulkModePrefix + kind)
		b, err := strconv.ParseBool(v)
		return ok && err == nil && b
	}
	prefs.BulkParams, prefs.BulkHeaders, prefs.BulkForm = bulk("params"), bulk("headers"), bulk("form")
	return prefs
}

// SetSidebarWidth saves the sidebar width in CSS px.
func (a *App) SetSidebarWidth(px int) EmptyResult {
	if px < MinSidebarWidth || px > maxSidebarWidth {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "sidebar width out of range"}}
	}
	return a.putSetting(settingSidebarWidth, strconv.Itoa(px))
}

// SetBulkMode saves whether a kind of key/value table (params | headers | form)
// shows the bulk text view, for every request.
func (a *App) SetBulkMode(kind string, on bool) EmptyResult {
	if !bulkKinds[kind] {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "unknown table kind"}}
	}
	return a.putSetting(settingBulkModePrefix+kind, strconv.FormatBool(on))
}

// SetResponseWrap saves whether response bodies wrap long lines.
func (a *App) SetResponseWrap(wrap bool) EmptyResult {
	return a.putSetting(settingResponseWrap, strconv.FormatBool(wrap))
}

func (a *App) setting(key string) (string, bool) {
	v, ok, err := a.store.Setting(a.ctx, key)
	if err != nil {
		slog.Error("load setting", "key", key, "err", err)
		return "", false
	}
	return v, ok
}

func (a *App) putSetting(key, value string) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.PutSetting(a.ctx, key, value); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}
