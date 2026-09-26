package workspace

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/store"
)

// fakeClient serves team/project lists from maps the test can mutate.
type fakeClient struct {
	teams    []api.TeamSummary
	projects map[string][]api.ProjectSummary
	err      error
}

func (f *fakeClient) ListTeams(context.Context) ([]api.TeamSummary, error) {
	return f.teams, f.err
}

func (f *fakeClient) ListProjects(_ context.Context, teamID string) ([]api.ProjectSummary, error) {
	if p, ok := f.projects[teamID]; ok {
		return p, nil
	}
	return []api.ProjectSummary{}, nil
}

func teams(ids ...string) []api.TeamSummary {
	out := []api.TeamSummary{}
	for _, id := range ids {
		out = append(out, api.TeamSummary{ID: id, Name: id})
	}
	return out
}

func projects(ids ...string) []api.ProjectSummary {
	out := []api.ProjectSummary{}
	for _, id := range ids {
		out = append(out, api.ProjectSummary{ID: id, Name: id})
	}
	return out
}

func setup(t *testing.T) (*Manager, *store.Store, *fakeClient) {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	c := &fakeClient{
		teams:    teams("t1", "t2"),
		projects: map[string][]api.ProjectSummary{"t1": projects("p1", "p2"), "t2": projects("p3")},
	}
	return New(st), st, c
}

func sel(ws Workspace) string { return ws.TeamID + "/" + ws.ProjectID }

func TestSelectionFlow(t *testing.T) {
	ctx := context.Background()
	m, st, c := setup(t)

	// Fresh install: first team, no project.
	ws, err := m.Load(ctx, c)
	if err != nil || sel(ws) != "t1/" || len(ws.Teams) != 2 || len(ws.Projects) != 2 {
		t.Fatalf("fresh load = %+v, %v", ws, err)
	}

	// Switching team selects its first project.
	if ws, _ = m.SelectTeam(ctx, c, "t2"); sel(ws) != "t2/p3" || ws.Projects[0].ID != "p3" {
		t.Fatalf("select t2 = %+v", ws)
	}
	if ws, _ = m.SelectTeam(ctx, c, "t1"); sel(ws) != "t1/p1" {
		t.Fatalf("select t1 = %s", sel(ws))
	}
	if ws, _ = m.SelectProject(ctx, c, "p2"); sel(ws) != "t1/p2" {
		t.Fatalf("select p2 = %s", sel(ws))
	}

	// Restart: a new manager over the same DB restores the selection.
	if ws, _ = New(st).Load(ctx, c); sel(ws) != "t1/p2" {
		t.Fatalf("after restart = %s", sel(ws))
	}

	// A project from another team is not accepted.
	if ws, _ = m.SelectProject(ctx, c, "p3"); sel(ws) != "t1/" {
		t.Fatalf("foreign project = %s", sel(ws))
	}
	// Deselect.
	must(t)(m.SelectProject(ctx, c, "p1"))
	if ws, _ = m.SelectProject(ctx, c, ""); sel(ws) != "t1/" {
		t.Fatalf("deselect = %s", sel(ws))
	}
}

func TestLoadRepairsVanishedSelection(t *testing.T) {
	ctx := context.Background()
	m, _, c := setup(t)
	must(t)(m.SelectTeam(ctx, c, "t1"))
	must(t)(m.SelectProject(ctx, c, "p2"))

	// Current project deleted (or access revoked): team kept, no project.
	c.projects["t1"] = projects("p1")
	if ws, _ := m.Load(ctx, c); sel(ws) != "t1/" {
		t.Fatalf("project gone = %s", sel(ws))
	}

	// Current team gone (removed from it / deleted): first remaining team, no project.
	must(t)(m.SelectProject(ctx, c, "p1"))
	c.teams = teams("t2")
	if ws, _ := m.Load(ctx, c); sel(ws) != "t2/" {
		t.Fatalf("team gone = %s", sel(ws))
	}

	// No teams at all.
	c.teams = teams()
	ws, _ := m.Load(ctx, c)
	if sel(ws) != "/" || ws.Teams == nil || ws.Projects == nil {
		t.Fatalf("no teams = %+v", ws)
	}

	// Selecting an unknown team falls back instead of failing.
	c.teams = teams("t1", "t2")
	if ws, _ := m.SelectTeam(ctx, c, "t9"); sel(ws) != "t1/" {
		t.Fatalf("unknown team = %s", sel(ws))
	}
}

func TestLoadErrorDoesNotTouchSelection(t *testing.T) {
	ctx := context.Background()
	m, st, c := setup(t)
	must(t)(m.SelectTeam(ctx, c, "t2"))

	c.err = errors.New("boom")
	if _, err := m.Load(ctx, c); err == nil {
		t.Fatal("expected error")
	}
	if v, _, _ := st.Setting(ctx, store.SettingCurrentTeamID); v != "t2" {
		t.Fatalf("selection changed on error: %q", v)
	}
}

// must(t)(m.SelectX(...)) fails the test if a setup call errors.
func must(t *testing.T) func(Workspace, error) {
	return func(_ Workspace, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
}
