package main

import (
	"context"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/session"
)

// Bound project/access methods: thin {data, error} wrappers over *api.APIClient
// (see teams.go for the pattern and helpers).

type ProjectListResult struct {
	Data  []api.ProjectSummary `json:"data"`
	Error *session.Problem     `json:"error,omitempty"`
}

type ProjectResult struct {
	Data  *api.Project     `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type ProjectAccessUserListResult struct {
	Data  []api.ProjectAccessUser `json:"data"`
	Error *session.Problem        `json:"error,omitempty"`
}

type ProjectAccessResult struct {
	Data  *api.ProjectAccess `json:"data"`
	Error *session.Problem   `json:"error,omitempty"`
}

type MemberAccessResult struct {
	Data  *api.MemberAccess `json:"data"`
	Error *session.Problem  `json:"error,omitempty"`
}

type MemberAccessViewResult struct {
	Data  *api.MemberAccessView `json:"data"`
	Error *session.Problem      `json:"error,omitempty"`
}

// CreateProject creates a project in a team; the current user becomes its owner.
func (a *App) CreateProject(teamID, name string) ProjectResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Project, error) {
		return c.CreateProject(ctx, teamID, strings.TrimSpace(name))
	})
	return ProjectResult{Data: ptr(v, p), Error: p}
}

// ListProjects returns the team's projects the current user can open, in team order.
func (a *App) ListProjects(teamID string) ProjectListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.ProjectSummary, error) {
		return c.ListProjects(ctx, teamID)
	})
	return ProjectListResult{Data: v, Error: p}
}

// GetProject returns one project.
func (a *App) GetProject(id string) ProjectResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Project, error) { return c.GetProject(ctx, id) })
	return ProjectResult{Data: ptr(v, p), Error: p}
}

// UpdateProjectName renames a project (team owner or project owner).
func (a *App) UpdateProjectName(id, name string) ProjectResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Project, error) {
		return c.UpdateProjectName(ctx, id, strings.TrimSpace(name))
	})
	return ProjectResult{Data: ptr(v, p), Error: p}
}

// DeleteProject deletes a project (team owner or project owner).
func (a *App) DeleteProject(id string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.DeleteProject(ctx, id) })
}

// ReorderProjects sets the team's project order (must list every team project).
func (a *App) ReorderProjects(teamID string, projectIDs []string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return c.ReorderProjects(ctx, teamID, projectIDs)
	})
}

// MoveProject moves a project one place up (offset -1) or down (+1) in the team order.
func (a *App) MoveProject(teamID, projectID string, offset int) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return c.MoveProject(ctx, teamID, projectID, offset)
	})
}

// GetProjectAccess returns a project's explicit grant list.
func (a *App) GetProjectAccess(id string) ProjectAccessUserListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.ProjectAccessUser, error) {
		return c.GetProjectAccess(ctx, id)
	})
	return ProjectAccessUserListResult{Data: v, Error: p}
}

// SetProjectAccess replaces a project's explicit grant list.
func (a *App) SetProjectAccess(id string, userIDs []string) ProjectAccessResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.ProjectAccess, error) {
		return c.SetProjectAccess(ctx, id, userIDs)
	})
	return ProjectAccessResult{Data: ptr(v, p), Error: p}
}

// GetMemberAccess returns a member's current access for the access editor (team owner).
func (a *App) GetMemberAccess(teamID, userID string) MemberAccessViewResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.MemberAccessView, error) {
		return c.LoadMemberAccess(ctx, teamID, userID)
	})
	return MemberAccessViewResult{Data: ptr(v, p), Error: p}
}

// SetMemberAccess sets which projects a member may open (team owner).
func (a *App) SetMemberAccess(teamID, userID string, allProjects bool, projectIDs []string) MemberAccessResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.MemberAccess, error) {
		return c.SetMemberAccess(ctx, teamID, userID, allProjects, projectIDs)
	})
	return MemberAccessResult{Data: ptr(v, p), Error: p}
}
