package main

import (
	"context"
	"net/http"
	"testing"
)

func TestBoundWorkspace(t *testing.T) {
	teams := `[{"id":"t1","name":"Alpha","member_count":1,"is_owner":true}]`
	projects := `[{"id":"p1","name":"P1","owner_id":"u1","sort_order":0,"created_at":"x"}]`
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/teams": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(teams)) },
		"GET /api/v1/teams/{team_id}/projects": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(projects))
		},
	})

	want := `{"data":{"teams":[{"id":"t1","name":"Alpha","member_count":1,"is_owner":true}],"team_id":"t1",` +
		`"projects":[{"id":"p1","name":"P1","owner_id":"u1","sort_order":0,"created_at":"x"}],"project_id":"p1"}}`
	if got := toJSON(t, a.SelectTeam("t1")); got != want {
		t.Fatalf("SelectTeam = %s\nwant %s", got, want)
	}

	// The selection survives a restart (new manager, same DB): LoadWorkspace restores it.
	a.session.Check(context.Background())
	if got := toJSON(t, a.LoadWorkspace()); got != want {
		t.Fatalf("LoadWorkspace = %s\nwant %s", got, want)
	}

	// Project deleted server-side: fall back to no project.
	projects = `[]`
	res := a.LoadWorkspace()
	if res.Error != nil || res.Data.TeamID != "t1" || res.Data.ProjectID != "" || res.Data.Projects == nil {
		t.Fatalf("after delete = %s", toJSON(t, res))
	}
}
