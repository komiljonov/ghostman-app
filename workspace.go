package main

import (
	"context"

	"ghostman/internal/api"
	"ghostman/internal/session"
	"ghostman/internal/workspace"
)

// Bound workspace methods: the current team/project selection behind the top bar.
// Each returns a fresh snapshot (teams, current team, its projects, current project).

type WorkspaceResult struct {
	Data  *workspace.Workspace `json:"data"`
	Error *session.Problem     `json:"error,omitempty"`
}

func (a *App) workspaceCall(fn func(context.Context, *api.APIClient) (workspace.Workspace, error)) WorkspaceResult {
	v, p := call(a, fn)
	return WorkspaceResult{Data: ptr(v, p), Error: p}
}

// LoadWorkspace returns the current selection, repaired if the stored team or
// project is gone (first team / no project).
func (a *App) LoadWorkspace() WorkspaceResult {
	return a.workspaceCall(func(ctx context.Context, c *api.APIClient) (workspace.Workspace, error) {
		return a.workspace.Load(ctx, c)
	})
}

// SelectTeam switches the current team; the project resets to the team's first project.
func (a *App) SelectTeam(teamID string) WorkspaceResult {
	return a.workspaceCall(func(ctx context.Context, c *api.APIClient) (workspace.Workspace, error) {
		return a.workspace.SelectTeam(ctx, c, teamID)
	})
}

// SelectProject switches the current project ("" for none).
func (a *App) SelectProject(projectID string) WorkspaceResult {
	return a.workspaceCall(func(ctx context.Context, c *api.APIClient) (workspace.Workspace, error) {
		return a.workspace.SelectProject(ctx, c, projectID)
	})
}
