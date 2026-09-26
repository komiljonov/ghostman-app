package main

import (
	"io"
	"net/http"
	"testing"
)

func TestBoundProjectMethods(t *testing.T) {
	var reorderBody string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/teams/{team_id}/projects": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"p1","name":"P1","owner_id":"u1","sort_order":0,"created_at":"x"}]`))
		},
		"PUT /api/v1/teams/{team_id}/projects/order": func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			reorderBody = string(raw)
			writeEnvelope(w, http.StatusBadRequest, "bad_request", "project_ids must list all 2 projects of this team, got 1")
		},
		"PATCH /api/v1/projects/{id}": func(w http.ResponseWriter, _ *http.Request) {
			writeEnvelope(w, http.StatusForbidden, "forbidden", "only the team owner or the project owner can do that")
		},
		"PUT /api/v1/projects/{id}/access": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"user_ids":[]}`))
		},
	})

	tests := []struct {
		name string
		got  any
		want string
	}{
		{"list", a.ListProjects("t1"),
			`{"data":[{"id":"p1","name":"P1","owner_id":"u1","sort_order":0,"created_at":"x"}]}`},
		{"reorder 400 keeps server message", a.ReorderProjects("t1", []string{"p1"}),
			`{"error":{"kind":"server","status":400,"code":"bad_request","message":"project_ids must list all 2 projects of this team, got 1"}}`},
		{"rename 403", a.UpdateProjectName("p1", "X"),
			`{"data":null,"error":{"kind":"server","status":403,"code":"forbidden","message":"only the team owner or the project owner can do that"}}`},
		{"clear access", a.SetProjectAccess("p1", nil), `{"data":{"user_ids":[]}}`},
	}
	for _, tt := range tests {
		if got := toJSON(t, tt.got); got != tt.want {
			t.Errorf("%s = %s\nwant %s", tt.name, got, tt.want)
		}
	}
	if reorderBody != `{"project_ids":["p1"]}` {
		t.Errorf("reorder body = %s", reorderBody)
	}
}
