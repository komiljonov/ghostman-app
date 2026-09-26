package api

import (
	"context"
	"net/http"
	"net/url"
)

// Server-shaped data keeps the server's snake_case field names end to end.

// TeamRef is a team's id and name.
type TeamRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TeamSummary is one entry of ListTeams.
type TeamSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MemberCount int64  `json:"member_count"`
	IsOwner     bool   `json:"is_owner"`
}

// TeamMember is a member row of a team.
type TeamMember struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	Name        string `json:"name"`
	AllProjects bool   `json:"all_projects"`
}

// Team is a team with its members. IsOwner refers to the caller.
type Team struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	CreatedAt string       `json:"created_at"`
	IsOwner   bool         `json:"is_owner"`
	Members   []TeamMember `json:"members"`
}

// Invitation is the result of CreateInvitation.
type Invitation struct {
	ID        string `json:"id"`
	TeamID    string `json:"team_id"`
	Email     string `json:"email"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

// TeamInvitation is a pending invitation as the team owner sees it.
type TeamInvitation struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"`
}

// Inviter identifies who sent an invitation.
type Inviter struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// MyInvitation is a pending invitation addressed to the caller.
type MyInvitation struct {
	ID        string  `json:"id"`
	Team      TeamRef `json:"team"`
	InvitedBy Inviter `json:"invited_by"`
	CreatedAt string  `json:"created_at"`
}

// AcceptedInvitation is the result of AcceptInvitation.
type AcceptedInvitation struct {
	ID     string  `json:"id"`
	Status string  `json:"status"`
	Team   TeamRef `json:"team"`
}

// CreateTeam creates a team owned by the caller.
func (c *APIClient) CreateTeam(ctx context.Context, name string) (TeamRef, error) {
	var out TeamRef
	err := c.do(ctx, http.MethodPost, "/api/v1/teams", map[string]string{"name": name}, &out)
	return out, err
}

// ListTeams returns the teams the caller belongs to.
func (c *APIClient) ListTeams(ctx context.Context) ([]TeamSummary, error) {
	out := []TeamSummary{}
	err := c.do(ctx, http.MethodGet, "/api/v1/teams", nil, &out)
	return out, err
}

// GetTeam returns a team with its members.
func (c *APIClient) GetTeam(ctx context.Context, id string) (Team, error) {
	var out Team
	err := c.do(ctx, http.MethodGet, "/api/v1/teams/"+url.PathEscape(id), nil, &out)
	return out, err
}

// UpdateTeamName renames a team (owner only) and returns the updated team.
func (c *APIClient) UpdateTeamName(ctx context.Context, id, name string) (Team, error) {
	var out Team
	err := c.do(ctx, http.MethodPatch, "/api/v1/teams/"+url.PathEscape(id), map[string]string{"name": name}, &out)
	return out, err
}

// DeleteTeam deletes a team (owner only).
func (c *APIClient) DeleteTeam(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/api/v1/teams/"+url.PathEscape(id), nil, nil)
}

// CreateInvitation invites email to a team (owner only).
func (c *APIClient) CreateInvitation(ctx context.Context, teamID, email string) (Invitation, error) {
	var out Invitation
	path := "/api/v1/teams/" + url.PathEscape(teamID) + "/invitations"
	err := c.do(ctx, http.MethodPost, path, map[string]string{"email": email}, &out)
	return out, err
}

// ListTeamInvitations returns a team's pending invitations (owner only).
func (c *APIClient) ListTeamInvitations(ctx context.Context, teamID string) ([]TeamInvitation, error) {
	out := []TeamInvitation{}
	err := c.do(ctx, http.MethodGet, "/api/v1/teams/"+url.PathEscape(teamID)+"/invitations", nil, &out)
	return out, err
}

// ListMyInvitations returns the pending invitations addressed to the caller.
func (c *APIClient) ListMyInvitations(ctx context.Context) ([]MyInvitation, error) {
	out := []MyInvitation{}
	err := c.do(ctx, http.MethodGet, "/api/v1/me/invitations", nil, &out)
	return out, err
}

// AcceptInvitation joins the invitation's team.
func (c *APIClient) AcceptInvitation(ctx context.Context, id string) (AcceptedInvitation, error) {
	var out AcceptedInvitation
	err := c.do(ctx, http.MethodPost, "/api/v1/invitations/"+url.PathEscape(id)+"/accept", nil, &out)
	return out, err
}

// RejectInvitation declines an invitation addressed to the caller.
func (c *APIClient) RejectInvitation(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodPost, "/api/v1/invitations/"+url.PathEscape(id)+"/reject", nil, nil)
}

// RevokeInvitation withdraws a pending invitation (team owner only).
func (c *APIClient) RevokeInvitation(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/api/v1/invitations/"+url.PathEscape(id), nil, nil)
}

// RemoveMember removes userID from a team: the owner removing a member, or a
// member removing themselves (leaving).
func (c *APIClient) RemoveMember(ctx context.Context, teamID, userID string) error {
	path := "/api/v1/teams/" + url.PathEscape(teamID) + "/members/" + url.PathEscape(userID)
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}
