package api

import (
	"context"
	"net/http"
	"net/url"
)

// ProjectSummary is one entry of ListProjects (only projects the caller can open).
type ProjectSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	OwnerID   string `json:"owner_id"`
	SortOrder int32  `json:"sort_order"`
	CreatedAt string `json:"created_at"`
}

// Project is a single project.
type Project struct {
	ID        string `json:"id"`
	TeamID    string `json:"team_id"`
	Name      string `json:"name"`
	OwnerID   string `json:"owner_id"`
	SortOrder int32  `json:"sort_order"`
	CreatedAt string `json:"created_at"`
}

// ProjectAccessUser is a member on a project's explicit grant list.
type ProjectAccessUser struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Name   string `json:"name"`
}

// ProjectAccess is the explicit grant list as stored after SetProjectAccess.
type ProjectAccess struct {
	UserIDs []string `json:"user_ids"`
}

// MemberAccess is what one member may open, as stored after SetMemberAccess.
type MemberAccess struct {
	UserID      string   `json:"user_id"`
	AllProjects bool     `json:"all_projects"`
	ProjectIDs  []string `json:"project_ids"`
}

func projectPath(id string) string { return "/api/v1/projects/" + url.PathEscape(id) }

// nonNil makes an empty list serialize as [] (the server rejects null for lists).
func nonNil(ids []string) []string {
	if ids == nil {
		return []string{}
	}
	return ids
}

// CreateProject creates a project in a team; the caller becomes its owner.
func (c *APIClient) CreateProject(ctx context.Context, teamID, name string) (Project, error) {
	var out Project
	path := "/api/v1/teams/" + url.PathEscape(teamID) + "/projects"
	err := c.do(ctx, http.MethodPost, path, map[string]string{"name": name}, &out)
	return out, err
}

// ListProjects returns the team's projects the caller can open, in team order.
func (c *APIClient) ListProjects(ctx context.Context, teamID string) ([]ProjectSummary, error) {
	out := []ProjectSummary{}
	err := c.do(ctx, http.MethodGet, "/api/v1/teams/"+url.PathEscape(teamID)+"/projects", nil, &out)
	return out, err
}

// GetProject returns one project the caller can open.
func (c *APIClient) GetProject(ctx context.Context, id string) (Project, error) {
	var out Project
	err := c.do(ctx, http.MethodGet, projectPath(id), nil, &out)
	return out, err
}

// UpdateProjectName renames a project (team owner or project owner).
func (c *APIClient) UpdateProjectName(ctx context.Context, id, name string) (Project, error) {
	var out Project
	err := c.do(ctx, http.MethodPatch, projectPath(id), map[string]string{"name": name}, &out)
	return out, err
}

// DeleteProject deletes a project (team owner or project owner).
func (c *APIClient) DeleteProject(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, projectPath(id), nil, nil)
}

// ReorderProjects sets the team's project order. projectIDs must list every
// project of the team exactly once, including ones the caller cannot open.
func (c *APIClient) ReorderProjects(ctx context.Context, teamID string, projectIDs []string) error {
	path := "/api/v1/teams/" + url.PathEscape(teamID) + "/projects/order"
	return c.do(ctx, http.MethodPut, path, map[string][]string{"project_ids": nonNil(projectIDs)}, nil)
}

// GetProjectAccess returns a project's explicit grant list (team or project owner).
func (c *APIClient) GetProjectAccess(ctx context.Context, id string) ([]ProjectAccessUser, error) {
	out := []ProjectAccessUser{}
	err := c.do(ctx, http.MethodGet, projectPath(id)+"/access", nil, &out)
	return out, err
}

// SetProjectAccess replaces a project's explicit grant list (team or project owner).
func (c *APIClient) SetProjectAccess(ctx context.Context, id string, userIDs []string) (ProjectAccess, error) {
	var out ProjectAccess
	err := c.do(ctx, http.MethodPut, projectPath(id)+"/access", map[string][]string{"user_ids": nonNil(userIDs)}, &out)
	return out, err
}

// SetMemberAccess sets which projects a member may open (team owner only).
// projectIDs is ignored by the server when allProjects is true.
func (c *APIClient) SetMemberAccess(ctx context.Context, teamID, userID string, allProjects bool, projectIDs []string) (MemberAccess, error) {
	var out MemberAccess
	path := "/api/v1/teams/" + url.PathEscape(teamID) + "/members/" + url.PathEscape(userID) + "/access"
	body := map[string]any{"all_projects": allProjects, "project_ids": nonNil(projectIDs)}
	err := c.do(ctx, http.MethodPut, path, body, &out)
	return out, err
}

// MemberProjectGrant is one team project and whether a member is explicitly granted it.
type MemberProjectGrant struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Granted bool   `json:"granted"`
}

// MemberAccessView is everything the member-access editor needs.
type MemberAccessView struct {
	UserID      string               `json:"user_id"`
	AllProjects bool                 `json:"all_projects"`
	Projects    []MemberProjectGrant `json:"projects"`
}

// LoadMemberAccess assembles a member's current access for the team owner. The
// server has no single endpoint for it, so this combines the team's member row,
// the project list (complete, since the caller is the owner) and each project's
// explicit grant list.
func (c *APIClient) LoadMemberAccess(ctx context.Context, teamID, userID string) (MemberAccessView, error) {
	team, err := c.GetTeam(ctx, teamID)
	if err != nil {
		return MemberAccessView{}, err
	}
	view := MemberAccessView{UserID: userID, Projects: []MemberProjectGrant{}}
	found := false
	for _, m := range team.Members {
		if m.UserID == userID {
			view.AllProjects, found = m.AllProjects, true
		}
	}
	if !found {
		return MemberAccessView{}, &APIError{Status: http.StatusNotFound, Code: "not_found", Message: "team member not found"}
	}

	projects, err := c.ListProjects(ctx, teamID)
	if err != nil {
		return MemberAccessView{}, err
	}
	for _, p := range projects {
		users, err := c.GetProjectAccess(ctx, p.ID)
		if err != nil {
			return MemberAccessView{}, err
		}
		granted := false
		for _, u := range users {
			granted = granted || u.UserID == userID
		}
		view.Projects = append(view.Projects, MemberProjectGrant{ID: p.ID, Name: p.Name, Granted: granted})
	}
	return view, nil
}

// MoveProject moves a project up (offset -1) or down (+1) in the team order. It
// reads the current order from the server first (nothing is cached) and sends the
// full list; if the caller cannot see every team project, the server rejects it
// with its "must list all" message.
func (c *APIClient) MoveProject(ctx context.Context, teamID, projectID string, offset int) error {
	projects, err := c.ListProjects(ctx, teamID)
	if err != nil {
		return err
	}
	ids := make([]string, len(projects))
	from := -1
	for i, p := range projects {
		ids[i] = p.ID
		if p.ID == projectID {
			from = i
		}
	}
	if from < 0 {
		return &APIError{Status: http.StatusNotFound, Code: "not_found", Message: "project not found"}
	}
	to := from + offset
	if to < 0 || to >= len(ids) {
		return nil // already at the edge
	}
	ids[from], ids[to] = ids[to], ids[from]
	return c.ReorderProjects(ctx, teamID, ids)
}
