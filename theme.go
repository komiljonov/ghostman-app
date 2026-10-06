package main

import (
	"log/slog"

	"ghostman/internal/session"
)

// Appearance (local UI state, no server involved).

// Theme preferences.
const (
	ThemeSystem = "system"
	ThemeDark   = "dark"
	ThemeLight  = "light"
)

const settingTheme = "theme"

func validTheme(t string) bool { return t == ThemeSystem || t == ThemeDark || t == ThemeLight }

// GetTheme returns the theme preference: "system" (default), "dark" or "light".
func (a *App) GetTheme() string {
	if a.store == nil {
		return ThemeSystem
	}
	v, ok, err := a.store.Setting(a.ctx, settingTheme)
	if err != nil {
		slog.Error("load theme", "err", err)
	}
	if !ok || !validTheme(v) {
		return ThemeSystem
	}
	return v
}

// SetTheme saves the theme preference; unknown values are refused.
func (a *App) SetTheme(theme string) EmptyResult {
	if !validTheme(theme) {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: `theme must be "system", "dark" or "light"`}}
	}
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.PutSetting(a.ctx, settingTheme, theme); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}
