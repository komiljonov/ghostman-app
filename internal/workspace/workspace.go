// Package workspace owns the "current team / current project" selection that
// drives the app shell. The selection is persisted locally (it is UI state), but
// every Load re-reads the team and project lists from the server and repairs a
// selection that is no longer valid, so the UI never lands on a dead end.
package workspace

import (
	"context"
	"log/slog"

	"ghostman/internal/api"
	"ghostman/internal/store"
)

// Workspace is everything the top bar needs: the user's teams, the current team,
// its accessible projects and the current project. Empty IDs mean "none".
type Workspace struct {
	Teams     []api.TeamSummary    `json:"teams"`
	TeamID    string               `json:"team_id"`
	Projects  []api.ProjectSummary `json:"projects"`
	ProjectID string               `json:"project_id"`
}

// Client is the part of *api.APIClient the workspace needs.
type Client interface {
	ListTeams(ctx context.Context) ([]api.TeamSummary, error)
	ListProjects(ctx context.Context, teamID string) ([]api.ProjectSummary, error)
}

// Settings is the local key/value store (implemented by *store.Store).
type Settings interface {
	Setting(ctx context.Context, key string) (string, bool, error)
	PutSetting(ctx context.Context, key, value string) error
}

// Manager reads and changes the selection.
type Manager struct {
	settings Settings
}

// New returns a Manager backed by settings.
func New(settings Settings) *Manager {
	return &Manager{settings: settings}
}

// Load returns the workspace for the stored selection, repairing it when the
// stored team or project no longer exists or is no longer accessible: an invalid
// team falls back to the first team, an invalid project to no project.
func (m *Manager) Load(ctx context.Context, c Client) (Workspace, error) {
	return m.build(ctx, c, m.get(ctx, store.SettingCurrentTeamID), m.get(ctx, store.SettingCurrentProjectID), false)
}

// SelectTeam switches to teamID and resets the project to the team's first
// accessible project (or none).
func (m *Manager) SelectTeam(ctx context.Context, c Client, teamID string) (Workspace, error) {
	return m.build(ctx, c, teamID, "", true)
}

// SelectProject switches the current project within the current team ("" = none).
func (m *Manager) SelectProject(ctx context.Context, c Client, projectID string) (Workspace, error) {
	return m.build(ctx, c, m.get(ctx, store.SettingCurrentTeamID), projectID, false)
}

// build validates the wanted selection against fresh server lists and persists
// the result. firstProject picks the team's first project when wantProject is
// empty or invalid (used when switching teams).
func (m *Manager) build(ctx context.Context, c Client, wantTeam, wantProject string, firstProject bool) (Workspace, error) {
	teams, err := c.ListTeams(ctx)
	if err != nil {
		return Workspace{}, err
	}
	ws := Workspace{Teams: teams, Projects: []api.ProjectSummary{}}

	switch {
	case containsTeam(teams, wantTeam):
		ws.TeamID = wantTeam
	case len(teams) > 0:
		ws.TeamID = teams[0].ID
	}
	if ws.TeamID != wantTeam {
		// Fell back to another team: the wanted project cannot belong to it, and a
		// fallback always lands on "no project" rather than guessing one.
		wantProject, firstProject = "", false
	}

	if ws.TeamID != "" {
		ws.Projects, err = c.ListProjects(ctx, ws.TeamID)
		if err != nil {
			return Workspace{}, err
		}
		switch {
		case containsProject(ws.Projects, wantProject):
			ws.ProjectID = wantProject
		case firstProject && len(ws.Projects) > 0:
			ws.ProjectID = ws.Projects[0].ID
		}
	}

	m.put(ctx, store.SettingCurrentTeamID, ws.TeamID)
	m.put(ctx, store.SettingCurrentProjectID, ws.ProjectID)
	return ws, nil
}

func (m *Manager) get(ctx context.Context, key string) string {
	v, _, err := m.settings.Setting(ctx, key)
	if err != nil {
		slog.Error("load selection", "key", key, "err", err)
	}
	return v
}

// put persists best-effort: losing the selection only costs a re-pick next launch.
func (m *Manager) put(ctx context.Context, key, value string) {
	if err := m.settings.PutSetting(ctx, key, value); err != nil {
		slog.Error("save selection", "key", key, "err", err)
	}
}

func containsTeam(teams []api.TeamSummary, id string) bool {
	for _, t := range teams {
		if id != "" && t.ID == id {
			return true
		}
	}
	return false
}

func containsProject(projects []api.ProjectSummary, id string) bool {
	for _, p := range projects {
		if id != "" && p.ID == id {
			return true
		}
	}
	return false
}
