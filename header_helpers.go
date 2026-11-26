package main

import (
	"encoding/json"
	"strings"
)

// Header-editing helpers, local to this machine (settings table):
//   - recently used header KEYS per project, offered first by the headers table's
//     key completion (the static common-header list lives with the completion rules,
//     src/headerComplete.ts);
//   - "Use the Auth tab" hint dismissals per request.

const (
	settingRecentHeaderKeysPrefix  = "recent_header_keys_"
	settingAuthHintDismissedPrefix = "ui_auth_hint_dismissed_"
	// MaxRecentHeaderKeys caps the recent list (oldest dropped).
	MaxRecentHeaderKeys = 30
)

// pushRecent puts key at the front of list: trimmed, deduplicated
// case-insensitively (the newest spelling wins), capped at max. An empty key
// changes nothing.
func pushRecent(list []string, key string, max int) []string {
	key = strings.TrimSpace(key)
	if key == "" {
		return list
	}
	out := []string{key}
	for _, k := range list {
		if !strings.EqualFold(k, key) && len(out) < max {
			out = append(out, k)
		}
	}
	return out
}

// GetRecentHeaderKeys returns the project's recently committed header keys, newest first.
func (a *App) GetRecentHeaderKeys(projectID string) []string {
	out := []string{}
	if a.store == nil || projectID == "" {
		return out
	}
	if v, ok := a.setting(settingRecentHeaderKeysPrefix + projectID); ok {
		_ = json.Unmarshal([]byte(v), &out)
	}
	return out
}

// AddRecentHeaderKey records a key the user committed in a header row and returns
// the new list (newest first, ≤ MaxRecentHeaderKeys).
func (a *App) AddRecentHeaderKey(projectID, key string) []string {
	list := pushRecent(a.GetRecentHeaderKeys(projectID), key, MaxRecentHeaderKeys)
	if a.store == nil || projectID == "" {
		return list
	}
	b, _ := json.Marshal(list)
	a.putSetting(settingRecentHeaderKeysPrefix+projectID, string(b))
	return list
}

// IsAuthHintDismissed reports whether the "Use the Auth tab" hint was dismissed
// for this request on this machine.
func (a *App) IsAuthHintDismissed(requestID string) bool {
	if a.store == nil || requestID == "" {
		return false
	}
	_, ok := a.setting(settingAuthHintDismissedPrefix + requestID)
	return ok
}

// DismissAuthHint hides the hint for this request on this machine, for good.
func (a *App) DismissAuthHint(requestID string) EmptyResult {
	return a.putSetting(settingAuthHintDismissedPrefix+requestID, "1")
}
