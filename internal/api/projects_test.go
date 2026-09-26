package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestProjectEndpoints(t *testing.T) {
	ctx := context.Background()
	const project = `{"id":"p1","team_id":"t1","name":"P1","owner_id":"u1","sort_order":0,"created_at":"2026-09-26T12:00:00Z"}`
	wantProject := Project{ID: "p1", TeamID: "t1", Name: "P1", OwnerID: "u1", SortOrder: 0, CreatedAt: "2026-09-26T12:00:00Z"}

	tests := []struct {
		name       string
		status     int
		resp       string
		call       func(c *APIClient) (any, error)
		wantMethod string
		wantPath   string
		wantRaw    string // exact JSON body sent ("" = none)
		want       any
	}{
		{
			name: "create project", status: 201, resp: project,
			call:       func(c *APIClient) (any, error) { return c.CreateProject(ctx, "t1", "P1") },
			wantMethod: "POST", wantPath: "/api/v1/teams/t1/projects", wantRaw: `{"name":"P1"}`,
			want: wantProject,
		},
		{
			name: "list projects", status: 200,
			resp:       `[{"id":"p1","name":"P1","owner_id":"u1","sort_order":0,"created_at":"2026-09-26T12:00:00Z"},{"id":"p2","name":"P2","owner_id":"u2","sort_order":1,"created_at":"2026-09-26T12:01:00Z"}]`,
			call:       func(c *APIClient) (any, error) { return c.ListProjects(ctx, "t1") },
			wantMethod: "GET", wantPath: "/api/v1/teams/t1/projects",
			want: []ProjectSummary{
				{ID: "p1", Name: "P1", OwnerID: "u1", SortOrder: 0, CreatedAt: "2026-09-26T12:00:00Z"},
				{ID: "p2", Name: "P2", OwnerID: "u2", SortOrder: 1, CreatedAt: "2026-09-26T12:01:00Z"},
			},
		},
		{
			name: "get project", status: 200, resp: project,
			call:       func(c *APIClient) (any, error) { return c.GetProject(ctx, "p1") },
			wantMethod: "GET", wantPath: "/api/v1/projects/p1",
			want: wantProject,
		},
		{
			name: "rename project", status: 200, resp: project,
			call:       func(c *APIClient) (any, error) { return c.UpdateProjectName(ctx, "p1", "P1") },
			wantMethod: "PATCH", wantPath: "/api/v1/projects/p1", wantRaw: `{"name":"P1"}`,
			want: wantProject,
		},
		{
			name: "delete project", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteProject(ctx, "p1") },
			wantMethod: "DELETE", wantPath: "/api/v1/projects/p1",
		},
		{
			name: "reorder projects", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.ReorderProjects(ctx, "t1", []string{"p2", "p1"}) },
			wantMethod: "PUT", wantPath: "/api/v1/teams/t1/projects/order", wantRaw: `{"project_ids":["p2","p1"]}`,
		},
		{
			name: "get project access", status: 200, resp: `[{"user_id":"u2","email":"b@x.io","name":"B"}]`,
			call:       func(c *APIClient) (any, error) { return c.GetProjectAccess(ctx, "p1") },
			wantMethod: "GET", wantPath: "/api/v1/projects/p1/access",
			want: []ProjectAccessUser{{UserID: "u2", Email: "b@x.io", Name: "B"}},
		},
		{
			name: "set project access", status: 200, resp: `{"user_ids":["u2"]}`,
			call:       func(c *APIClient) (any, error) { return c.SetProjectAccess(ctx, "p1", []string{"u2"}) },
			wantMethod: "PUT", wantPath: "/api/v1/projects/p1/access", wantRaw: `{"user_ids":["u2"]}`,
			want: ProjectAccess{UserIDs: []string{"u2"}},
		},
		{
			name: "clear project access sends [] not null", status: 200, resp: `{"user_ids":[]}`,
			call:       func(c *APIClient) (any, error) { return c.SetProjectAccess(ctx, "p1", nil) },
			wantMethod: "PUT", wantPath: "/api/v1/projects/p1/access", wantRaw: `{"user_ids":[]}`,
			want: ProjectAccess{UserIDs: []string{}},
		},
		{
			name: "set member access selected", status: 200, resp: `{"user_id":"u2","all_projects":false,"project_ids":["p1"]}`,
			call: func(c *APIClient) (any, error) {
				return c.SetMemberAccess(ctx, "t1", "u2", false, []string{"p1"})
			},
			wantMethod: "PUT", wantPath: "/api/v1/teams/t1/members/u2/access",
			wantRaw: `{"all_projects":false,"project_ids":["p1"]}`,
			want:    MemberAccess{UserID: "u2", AllProjects: false, ProjectIDs: []string{"p1"}},
		},
		{
			name: "set member access all", status: 200, resp: `{"user_id":"u2","all_projects":true,"project_ids":[]}`,
			call:       func(c *APIClient) (any, error) { return c.SetMemberAccess(ctx, "t1", "u2", true, nil) },
			wantMethod: "PUT", wantPath: "/api/v1/teams/t1/members/u2/access",
			wantRaw: `{"all_projects":true,"project_ids":[]}`,
			want:    MemberAccess{UserID: "u2", AllProjects: true, ProjectIDs: []string{}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, rec := replayServer(t, tt.status, tt.resp)
			got, err := tt.call(c)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rec.method != tt.wantMethod || rec.path != tt.wantPath || rec.auth != "Bearer tok" {
				t.Errorf("request = %s %s (auth %q), want %s %s", rec.method, rec.path, rec.auth, tt.wantMethod, tt.wantPath)
			}
			if rec.raw != tt.wantRaw {
				t.Errorf("body = %s, want %s", rec.raw, tt.wantRaw)
			}
			if tt.want != nil && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestProjectEndpointErrors(t *testing.T) {
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
		{
			// Reorder must name every project of the team, even ones the caller cannot see.
			"reorder not exact set", 400, env("bad_request", "project_ids must list all 3 projects of this team, got 2"),
			func(c *APIClient) error { return c.ReorderProjects(ctx, "t1", []string{"p1", "p2"}) },
			"project_ids must list all 3 projects of this team, got 2",
		},
		{
			// A plain member renaming someone else's project (step 4 of the spec).
			"rename not manager", 403, env("forbidden", "only the team owner or the project owner can do that"),
			func(c *APIClient) error { _, err := c.UpdateProjectName(ctx, "p1", "X"); return err },
			"only the team owner or the project owner can do that",
		},
		{
			"owner access fixed", 400, env("bad_request", "the team owner always has access to every project"),
			func(c *APIClient) error { _, err := c.SetMemberAccess(ctx, "t1", "u1", false, nil); return err },
			"the team owner always has access to every project",
		},
		{
			"grant to non-member", 400, env("bad_request", "user_ids contains u9, which is not a member of this team"),
			func(c *APIClient) error { _, err := c.SetProjectAccess(ctx, "p1", []string{"u9"}); return err },
			"user_ids contains u9, which is not a member of this team",
		},
		{
			"hidden project", 404, env("not_found", "project not found"),
			func(c *APIClient) error { _, err := c.GetProject(ctx, "p2"); return err },
			"project not found",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := replayServer(t, tt.status, tt.resp)
			err := tt.call(c)
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.Status != tt.status || apiErr.Message != tt.wantMsg {
				t.Fatalf("err = %#v, want %d %q", err, tt.status, tt.wantMsg)
			}
			if strings.Contains(apiErr.Message, "{") {
				t.Errorf("message leaks JSON: %q", apiErr.Message)
			}
		})
	}
}

func TestLoadMemberAccess(t *testing.T) {
	c, _ := routeServer(t, map[string]string{
		"GET /api/v1/teams/t1": `{"id":"t1","name":"Alpha","created_at":"x","is_owner":true,"members":[
			{"user_id":"u1","email":"a@x.io","name":"A","all_projects":true},
			{"user_id":"u2","email":"b@x.io","name":"B","all_projects":false}]}`,
		"GET /api/v1/teams/t1/projects": `[{"id":"p1","name":"P1","owner_id":"u1","sort_order":0,"created_at":"x"},
			{"id":"p2","name":"P2","owner_id":"u1","sort_order":1,"created_at":"x"}]`,
		"GET /api/v1/projects/p1/access": `[{"user_id":"u2","email":"b@x.io","name":"B"}]`,
		"GET /api/v1/projects/p2/access": `[]`,
	})
	got, err := c.LoadMemberAccess(context.Background(), "t1", "u2")
	if err != nil {
		t.Fatal(err)
	}
	want := MemberAccessView{UserID: "u2", AllProjects: false, Projects: []MemberProjectGrant{
		{ID: "p1", Name: "P1", Granted: true}, {ID: "p2", Name: "P2", Granted: false},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v\nwant %#v", got, want)
	}

	if _, err := c.LoadMemberAccess(context.Background(), "t1", "u9"); err == nil || err.Error() != "team member not found" {
		t.Fatalf("unknown member: err = %v", err)
	}
}

func TestMoveProject(t *testing.T) {
	var sent []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v1/teams/t1/projects":
			_, _ = w.Write([]byte(`[{"id":"p1"},{"id":"p2"},{"id":"p3"}]`))
		case "PUT /api/v1/teams/t1/projects/order":
			var body struct {
				ProjectIDs []string `json:"project_ids"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			sent = body.ProjectIDs
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c := New(srv.URL)
	ctx := context.Background()

	tests := []struct {
		id     string
		offset int
		want   []string // nil = no request sent
	}{
		{"p3", -1, []string{"p1", "p3", "p2"}},
		{"p1", +1, []string{"p2", "p1", "p3"}},
		{"p1", -1, nil}, // already first
		{"p3", +1, nil}, // already last
	}
	for _, tt := range tests {
		sent = nil
		if err := c.MoveProject(ctx, "t1", tt.id, tt.offset); err != nil {
			t.Fatalf("move %s %+d: %v", tt.id, tt.offset, err)
		}
		if !reflect.DeepEqual(sent, tt.want) {
			t.Errorf("move %s %+d sent %v, want %v", tt.id, tt.offset, sent, tt.want)
		}
	}
	if err := c.MoveProject(ctx, "t1", "p9", 1); err == nil || err.Error() != "project not found" {
		t.Errorf("unknown project: err = %v", err)
	}
}
