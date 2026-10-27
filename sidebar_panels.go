package main

import (
	"encoding/json"

	"ghostman/internal/session"
)

// The sidebar's bottom area: a stack of collapsible sections (Webhooks, then
// Proxies) docked under the tree. Its state is local UI state per project: which
// sections are expanded, and the area's height as a fraction of the sidebar (the
// UI applies the pixel minimums; expanded sections split the area).

const (
	settingSidebarPanelsPrefix = "ui_sidebar_panels_"
	// settingWebhookPanelPrefix is the older webhook-only state ({expanded,
	// fraction}), read once as the fallback so existing state carries over.
	settingWebhookPanelPrefix = "ui_webhooks_panel_"
	// DefaultPanelFraction is the expanded area's default share of the sidebar height.
	DefaultPanelFraction = 0.3
)

// SidebarPanelPrefs is the bottom area's persisted state.
type SidebarPanelPrefs struct {
	Webhooks bool    `json:"webhooks"` // the Webhooks section is expanded
	Proxies  bool    `json:"proxies"`  // the Proxies section is expanded
	Fraction float64 `json:"fraction"` // height of the area while a section is expanded
}

func validFraction(f float64) bool { return f > 0 && f < 1 }

// GetSidebarPanels returns the project's bottom-area state (both sections
// collapsed, 30 % by default; an old webhook-panel state is honoured).
func (a *App) GetSidebarPanels(projectID string) SidebarPanelPrefs {
	prefs := SidebarPanelPrefs{Fraction: DefaultPanelFraction}
	if a.store == nil || projectID == "" {
		return prefs
	}
	if v, ok := a.setting(settingSidebarPanelsPrefix + projectID); ok {
		var saved SidebarPanelPrefs
		if json.Unmarshal([]byte(v), &saved) == nil {
			prefs.Webhooks, prefs.Proxies = saved.Webhooks, saved.Proxies
			if validFraction(saved.Fraction) {
				prefs.Fraction = saved.Fraction
			}
		}
		return prefs
	}
	if v, ok := a.setting(settingWebhookPanelPrefix + projectID); ok {
		var legacy struct {
			Expanded bool    `json:"expanded"`
			Fraction float64 `json:"fraction"`
		}
		if json.Unmarshal([]byte(v), &legacy) == nil {
			prefs.Webhooks = legacy.Expanded
			if validFraction(legacy.Fraction) {
				prefs.Fraction = legacy.Fraction
			}
		}
	}
	return prefs
}

// SetSidebarPanels saves the project's bottom-area state.
func (a *App) SetSidebarPanels(projectID string, prefs SidebarPanelPrefs) EmptyResult {
	if projectID == "" || !validFraction(prefs.Fraction) {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "panel height out of range"}}
	}
	raw, _ := json.Marshal(prefs)
	return a.putSetting(settingSidebarPanelsPrefix+projectID, string(raw))
}
