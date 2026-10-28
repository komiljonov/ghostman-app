package main

import (
	"encoding/json"
	"log/slog"
	"slices"

	"ghostman/internal/api"
	"ghostman/internal/authmemory"
	"ghostman/internal/session"
)

// Auth-field memory (rules: internal/authmemory). Captured after every
// successful auth save of a request (SaveRequest) or folder (SaveFolderSettings)
// into local SQLite auth_defaults, per project + type; SwitchAuthType prefills
// from it. LOCAL ONLY by design: the values may be literal secrets — they never
// sync and are never logged (failures log the type only).

// AuthSwitch is a node's auth after a mode switch.
type AuthSwitch struct {
	Auth      api.Auth `json:"auth"`
	Prefilled bool     `json:"prefilled"` // the type's fields came from the memory
}

type AuthSwitchResult struct {
	Data  *AuthSwitch      `json:"data,omitempty"`
	Error *session.Problem `json:"error,omitempty"`
}

// rememberAuth records a successful auth save base → next (a capture only when
// it changed a field of next's type: authmemory.Captures).
func (a *App) rememberAuth(projectID string, base, next api.Auth) {
	if !authmemory.Captures(base, next) || a.store == nil || projectID == "" {
		return
	}
	f, ok := authmemory.Extract(next)
	if !ok {
		return
	}
	b, err := json.Marshal(f)
	if err == nil {
		err = a.store.SetAuthDefault(a.ctx, projectID, f.Type, string(b))
	}
	if err != nil {
		slog.Warn("could not remember auth fields", "type", f.Type, "err", err)
	}
}

// rememberedAuth is the memory of a type in a project (nil = none).
func (a *App) rememberedAuth(projectID, authType string) *api.Auth {
	if a.store == nil || !authmemory.Remembered(authType) {
		return nil
	}
	raw, ok, err := a.store.AuthDefault(a.ctx, projectID, authType)
	if err != nil {
		slog.Warn("could not read remembered auth fields", "type", authType, "err", err)
		return nil
	}
	var m api.Auth
	if !ok || json.Unmarshal([]byte(raw), &m) != nil {
		return nil
	}
	return &m
}

// SwitchAuthType is the Auth mode select of a request tab or the folder modal:
// the node's config with its type switched — prefilled from this project's
// memory when that type's fields are all empty. Local only: no server call (the
// caller's autosave / Save persists the result like any edit).
func (a *App) SwitchAuthType(projectID string, current api.Auth, authType string) AuthSwitchResult {
	if !slices.Contains(api.AuthTypes, authType) {
		return AuthSwitchResult{Error: invalidAuth()}
	}
	out, filled := authmemory.Switch(api.NormalizeAuth(current), authType, a.rememberedAuth(projectID, authType))
	return AuthSwitchResult{Data: &AuthSwitch{Auth: out, Prefilled: filled}}
}
