package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

// recorded is what the fake server saw for one call.
type recorded struct {
	method, path, auth string
	body               map[string]string
}

// replayServer answers every request with status/body and records it.
func replayServer(t *testing.T, status int, body string) (*APIClient, *recorded) {
	t.Helper()
	rec := &recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.method, rec.path, rec.auth = r.Method, r.URL.EscapedPath(), r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		rec.body = nil
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &rec.body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	c := New(srv.URL)
	c.SetToken("tok")
	return c, rec
}

func TestTeamEndpoints(t *testing.T) {
	ctx := context.Background()
	const team = `{"id":"t1","name":"Alpha","created_at":"2026-09-26T12:00:00Z","is_owner":true,
		"members":[{"user_id":"u1","email":"a@x.io","name":"A","all_projects":true}]}`

	tests := []struct {
		name       string
		status     int
		resp       string
		call       func(c *APIClient) (any, error)
		wantMethod string
		wantPath   string
		wantBody   map[string]string
		want       any
	}{
		{
			name: "create team", status: 201, resp: `{"id":"t1","name":"Alpha"}`,
			call:       func(c *APIClient) (any, error) { return c.CreateTeam(ctx, "Alpha") },
			wantMethod: "POST", wantPath: "/api/v1/teams", wantBody: map[string]string{"name": "Alpha"},
			want: TeamRef{ID: "t1", Name: "Alpha"},
		},
		{
			name: "list teams", status: 200, resp: `[{"id":"t1","name":"Alpha","member_count":2,"is_owner":true}]`,
			call:       func(c *APIClient) (any, error) { return c.ListTeams(ctx) },
			wantMethod: "GET", wantPath: "/api/v1/teams",
			want: []TeamSummary{{ID: "t1", Name: "Alpha", MemberCount: 2, IsOwner: true}},
		},
		{
			name: "list teams empty", status: 200, resp: `[]`,
			call:       func(c *APIClient) (any, error) { return c.ListTeams(ctx) },
			wantMethod: "GET", wantPath: "/api/v1/teams",
			want: []TeamSummary{},
		},
		{
			name: "get team", status: 200, resp: team,
			call:       func(c *APIClient) (any, error) { return c.GetTeam(ctx, "t1") },
			wantMethod: "GET", wantPath: "/api/v1/teams/t1",
			want: Team{ID: "t1", Name: "Alpha", CreatedAt: "2026-09-26T12:00:00Z", IsOwner: true,
				Members: []TeamMember{{UserID: "u1", Email: "a@x.io", Name: "A", AllProjects: true}}},
		},
		{
			name: "rename team", status: 200, resp: team,
			call:       func(c *APIClient) (any, error) { t, err := c.UpdateTeamName(ctx, "t1", "Alpha"); return t.Name, err },
			wantMethod: "PATCH", wantPath: "/api/v1/teams/t1", wantBody: map[string]string{"name": "Alpha"},
			want: "Alpha",
		},
		{
			name: "delete team", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteTeam(ctx, "t1") },
			wantMethod: "DELETE", wantPath: "/api/v1/teams/t1",
		},
		{
			name: "create invitation", status: 201,
			resp:       `{"id":"i1","team_id":"t1","email":"b@x.io","status":"pending","created_at":"2026-09-26T12:00:00Z"}`,
			call:       func(c *APIClient) (any, error) { return c.CreateInvitation(ctx, "t1", "b@x.io") },
			wantMethod: "POST", wantPath: "/api/v1/teams/t1/invitations", wantBody: map[string]string{"email": "b@x.io"},
			want: Invitation{ID: "i1", TeamID: "t1", Email: "b@x.io", Status: "pending", CreatedAt: "2026-09-26T12:00:00Z"},
		},
		{
			name: "list team invitations", status: 200, resp: `[{"id":"i1","email":"b@x.io","created_at":"2026-09-26T12:00:00Z"}]`,
			call:       func(c *APIClient) (any, error) { return c.ListTeamInvitations(ctx, "t1") },
			wantMethod: "GET", wantPath: "/api/v1/teams/t1/invitations",
			want: []TeamInvitation{{ID: "i1", Email: "b@x.io", CreatedAt: "2026-09-26T12:00:00Z"}},
		},
		{
			name: "list my invitations", status: 200,
			resp:       `[{"id":"i1","team":{"id":"t1","name":"Alpha"},"invited_by":{"name":"A","email":"a@x.io"},"created_at":"2026-09-26T12:00:00Z"}]`,
			call:       func(c *APIClient) (any, error) { return c.ListMyInvitations(ctx) },
			wantMethod: "GET", wantPath: "/api/v1/me/invitations",
			want: []MyInvitation{{ID: "i1", Team: TeamRef{ID: "t1", Name: "Alpha"},
				InvitedBy: Inviter{Name: "A", Email: "a@x.io"}, CreatedAt: "2026-09-26T12:00:00Z"}},
		},
		{
			name: "accept invitation", status: 200, resp: `{"id":"i1","status":"accepted","team":{"id":"t1","name":"Alpha"}}`,
			call:       func(c *APIClient) (any, error) { return c.AcceptInvitation(ctx, "i1") },
			wantMethod: "POST", wantPath: "/api/v1/invitations/i1/accept",
			want: AcceptedInvitation{ID: "i1", Status: "accepted", Team: TeamRef{ID: "t1", Name: "Alpha"}},
		},
		{
			name: "reject invitation", status: 200, resp: `{"id":"i1","status":"rejected"}`,
			call:       func(c *APIClient) (any, error) { return nil, c.RejectInvitation(ctx, "i1") },
			wantMethod: "POST", wantPath: "/api/v1/invitations/i1/reject",
		},
		{
			name: "revoke invitation", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.RevokeInvitation(ctx, "i1") },
			wantMethod: "DELETE", wantPath: "/api/v1/invitations/i1",
		},
		{
			name: "remove member", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.RemoveMember(ctx, "t1", "u2") },
			wantMethod: "DELETE", wantPath: "/api/v1/teams/t1/members/u2",
		},
		{
			name: "ids are path-escaped", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteTeam(ctx, "a/b c") },
			wantMethod: "DELETE", wantPath: "/api/v1/teams/a%2Fb%20c",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, rec := replayServer(t, tt.status, tt.resp)
			got, err := tt.call(c)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rec.method != tt.wantMethod || rec.path != tt.wantPath {
				t.Errorf("request = %s %s, want %s %s", rec.method, rec.path, tt.wantMethod, tt.wantPath)
			}
			if rec.auth != "Bearer tok" {
				t.Errorf("Authorization = %q", rec.auth)
			}
			if !reflect.DeepEqual(rec.body, tt.wantBody) {
				t.Errorf("body = %v, want %v", rec.body, tt.wantBody)
			}
			if tt.want != nil && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestTeamEndpointErrors(t *testing.T) {
	ctx := context.Background()
	env := func(code, msg string) string {
		return `{"error":{"code":"` + code + `","message":"` + msg + `"}}`
	}
	tests := []struct {
		name    string
		status  int
		resp    string
		call    func(c *APIClient) error
		wantMsg string
	}{
		{"duplicate invite", 409, env("conflict", "an invitation for that email is already pending"),
			func(c *APIClient) error { _, err := c.CreateInvitation(ctx, "t1", "b@x.io"); return err },
			"an invitation for that email is already pending"},
		{"already member", 409, env("conflict", "that email is already a member of this team"),
			func(c *APIClient) error { _, err := c.CreateInvitation(ctx, "t1", "b@x.io"); return err },
			"that email is already a member of this team"},
		{"own email", 409, env("conflict", "you cannot invite yourself"),
			func(c *APIClient) error { _, err := c.CreateInvitation(ctx, "t1", "a@x.io"); return err },
			"you cannot invite yourself"},
		{"answered", 409, env("conflict", "this invitation has already been answered"),
			func(c *APIClient) error { _, err := c.AcceptInvitation(ctx, "i1"); return err },
			"this invitation has already been answered"},
		{"not owner", 403, env("forbidden", "only the team owner can do that"),
			func(c *APIClient) error { return c.DeleteTeam(ctx, "t1") },
			"only the team owner can do that"},
		{"not found", 404, env("not_found", "team not found"),
			func(c *APIClient) error { _, err := c.GetTeam(ctx, "t1"); return err },
			"team not found"},
		{"owner cannot leave", 400, env("bad_request", "the team owner cannot be removed; transfer ownership first"),
			func(c *APIClient) error { return c.RemoveMember(ctx, "t1", "u1") },
			"the team owner cannot be removed; transfer ownership first"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := replayServer(t, tt.status, tt.resp)
			err := tt.call(c)
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.Status != tt.status || apiErr.Message != tt.wantMsg {
				t.Fatalf("err = %#v, want status %d message %q", err, tt.status, tt.wantMsg)
			}
		})
	}
}
