package main

import (
	"encoding/json"
	"log/slog"
	"strings"

	"ghostman/internal/session"
)

// Editor-group layout (split tree + each group's tabs), local UI state, stored
// as versioned JSON ({"version": 1, "layout": ...}) under
// ui_layout_<user_id>_<project_id> — per user too, so two accounts on one
// machine never inherit each other's layout. The UI owns the tree rules
// (frontend/src/layoutTree.ts: parse, repair, prune gone tabs); Go checks the
// envelope, migrates the old per-project tab list once, and frees the full
// response bodies of request tabs that are no longer open.

const (
	layoutVersion  = 1
	maxLayoutBytes = 256 * 1024
)

func layoutKey(userID, projectID string) string { return "ui_layout_" + userID + "_" + projectID }

func (a *App) currentUserID() string {
	if u := a.session.State().User; u != nil {
		return u.ID
	}
	return ""
}

// layoutNode is the stored tree, read only to validate and to find open tabs.
type layoutNode struct {
	Type     string       `json:"type"`
	Children []layoutNode `json:"children,omitempty"`
	Tabs     []string     `json:"tabs,omitempty"`
}

type layoutDoc struct {
	Version int `json:"version"`
	Layout  struct {
		Root layoutNode `json:"root"`
	} `json:"layout"`
}

func (n layoutNode) tabKeys(out []string) []string {
	out = append(out, n.Tabs...)
	for _, c := range n.Children {
		out = c.tabKeys(out)
	}
	return out
}

// GetLayout returns the project's stored layout JSON for the current user, or —
// the first time — one group holding the old per-project tab list (migrated
// once), or "" when there is nothing (the UI starts with one empty group). The UI
// validates and repairs whatever comes back; corrupt data never crashes it.
func (a *App) GetLayout(projectID string) string {
	user := a.currentUserID()
	if a.store == nil || projectID == "" || user == "" {
		return ""
	}
	raw, ok, err := a.store.Setting(a.ctx, layoutKey(user, projectID))
	if err != nil {
		slog.Warn("load layout", "project", projectID, "err", err)
		return ""
	}
	if ok {
		return raw
	}
	return a.legacyLayout(projectID)
}

// legacyLayout turns the old ui_tabs_<project> list into a single-group layout.
func (a *App) legacyLayout(projectID string) string {
	tabs := a.GetTabs(projectID)
	if len(tabs.Open) == 0 {
		return ""
	}
	keys := make([]string, 0, len(tabs.Open))
	for _, t := range tabs.Open {
		keys = append(keys, t.Kind+":"+t.ID)
	}
	var active any // null without an active tab
	if tabs.Active.Kind != "" {
		active = tabs.Active.Kind + ":" + tabs.Active.ID
	}
	doc := map[string]any{
		"version": layoutVersion,
		"layout": map[string]any{
			"root":           map[string]any{"type": "group", "id": "g-migrated", "tabs": keys, "activeTabId": active},
			"focusedGroupId": "g-migrated",
		},
	}
	b, _ := json.Marshal(doc)
	return string(b)
}

// SetLayout stores the layout JSON (debounced by the UI; also flushed on quit).
// Request tabs that are no longer open anywhere free their Go-side full bodies.
func (a *App) SetLayout(projectID, layoutJSON string) EmptyResult {
	user := a.currentUserID()
	if a.store == nil || projectID == "" || user == "" {
		return EmptyResult{}
	}
	invalid := func(msg string) EmptyResult {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: msg}}
	}
	if len(layoutJSON) > maxLayoutBytes {
		return invalid("layout too large")
	}
	var doc layoutDoc
	if err := json.Unmarshal([]byte(layoutJSON), &doc); err != nil || doc.Version != layoutVersion {
		return invalid("unsupported layout data")
	}
	open := map[string]bool{}
	for _, k := range doc.Layout.Root.tabKeys(nil) {
		if id, ok := strings.CutPrefix(k, TabRequest+":"); ok && id != "" {
			open[id] = true
		}
	}
	a.responses.keepOnly(projectID, open)
	if err := a.store.PutSetting(a.ctx, layoutKey(user, projectID), layoutJSON); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}
