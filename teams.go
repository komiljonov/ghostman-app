package main

import (
	"context"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/session"
)

// Bound team/invitation methods. Each is a thin wrapper over *api.APIClient that
// returns {data, error}: expected failures travel in Error, never as a rejected promise.
// (Wails v2 cannot bind generic types, hence one result type per data shape.)

// EmptyResult is returned by mutations with no payload.
type EmptyResult struct {
	Error *session.Problem `json:"error,omitempty"`
}

type TeamRefResult struct {
	Data  *api.TeamRef     `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type TeamListResult struct {
	Data  []api.TeamSummary `json:"data"`
	Error *session.Problem  `json:"error,omitempty"`
}

type TeamResult struct {
	Data  *api.Team        `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type InvitationResult struct {
	Data  *api.Invitation  `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type TeamInvitationListResult struct {
	Data  []api.TeamInvitation `json:"data"`
	Error *session.Problem     `json:"error,omitempty"`
}

type MyInvitationListResult struct {
	Data  []api.MyInvitation `json:"data"`
	Error *session.Problem   `json:"error,omitempty"`
}

type AcceptedInvitationResult struct {
	Data  *api.AcceptedInvitation `json:"data"`
	Error *session.Problem        `json:"error,omitempty"`
}

var problemNotLoggedIn = &session.Problem{Kind: session.KindInvalid, Message: "you are not logged in"}

// call runs fn with the logged-in client and maps its error to a Problem.
func call[T any](a *App, fn func(context.Context, *api.APIClient) (T, error)) (T, *session.Problem) {
	var zero T
	a.clientMu.Lock()
	c := a.client
	a.clientMu.Unlock()
	if c == nil || a.session == nil || !a.session.IsLoggedIn() {
		return zero, problemNotLoggedIn
	}

	out, err := fn(a.ctx, c)
	if err != nil {
		if api.IsUnauthorized(err) {
			// The session expired or was revoked: re-checking clears the token and
			// moves the auth state to logged_out, which the UI then picks up.
			a.session.Check(a.ctx)
		}
		return zero, session.ProblemFrom(err)
	}
	return out, nil
}

// callEmpty is call for methods that return only an error.
func callEmpty(a *App, fn func(context.Context, *api.APIClient) error) EmptyResult {
	_, p := call(a, func(ctx context.Context, c *api.APIClient) (struct{}, error) {
		return struct{}{}, fn(ctx, c)
	})
	return EmptyResult{Error: p}
}

func ptr[T any](v T, p *session.Problem) *T {
	if p != nil {
		return nil
	}
	return &v
}

// CreateTeam creates a team owned by the current user.
func (a *App) CreateTeam(name string) TeamRefResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.TeamRef, error) {
		return c.CreateTeam(ctx, strings.TrimSpace(name))
	})
	return TeamRefResult{Data: ptr(v, p), Error: p}
}

// ListTeams returns the current user's teams.
func (a *App) ListTeams() TeamListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.TeamSummary, error) { return c.ListTeams(ctx) })
	return TeamListResult{Data: v, Error: p}
}

// GetTeam returns a team with its members.
func (a *App) GetTeam(id string) TeamResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Team, error) { return c.GetTeam(ctx, id) })
	return TeamResult{Data: ptr(v, p), Error: p}
}

// UpdateTeamName renames a team (owner only).
func (a *App) UpdateTeamName(id, name string) TeamResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Team, error) {
		return c.UpdateTeamName(ctx, id, strings.TrimSpace(name))
	})
	return TeamResult{Data: ptr(v, p), Error: p}
}

// DeleteTeam deletes a team (owner only).
func (a *App) DeleteTeam(id string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.DeleteTeam(ctx, id) })
}

// CreateInvitation invites an email address to a team (owner only).
func (a *App) CreateInvitation(teamID, email string) InvitationResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Invitation, error) {
		return c.CreateInvitation(ctx, teamID, strings.TrimSpace(email))
	})
	return InvitationResult{Data: ptr(v, p), Error: p}
}

// ListTeamInvitations returns a team's pending invitations (owner only).
func (a *App) ListTeamInvitations(teamID string) TeamInvitationListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.TeamInvitation, error) {
		return c.ListTeamInvitations(ctx, teamID)
	})
	return TeamInvitationListResult{Data: v, Error: p}
}

// ListMyInvitations returns the invitations addressed to the current user.
func (a *App) ListMyInvitations() MyInvitationListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.MyInvitation, error) {
		return c.ListMyInvitations(ctx)
	})
	return MyInvitationListResult{Data: v, Error: p}
}

// AcceptInvitation joins the invitation's team.
func (a *App) AcceptInvitation(id string) AcceptedInvitationResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.AcceptedInvitation, error) {
		return c.AcceptInvitation(ctx, id)
	})
	return AcceptedInvitationResult{Data: ptr(v, p), Error: p}
}

// RejectInvitation declines an invitation.
func (a *App) RejectInvitation(id string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.RejectInvitation(ctx, id) })
}

// RevokeInvitation withdraws a pending invitation (owner only).
func (a *App) RevokeInvitation(id string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.RevokeInvitation(ctx, id) })
}

// RemoveMember removes a member (owner), or leaves the team when userID is the current user.
func (a *App) RemoveMember(teamID, userID string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.RemoveMember(ctx, teamID, userID) })
}
