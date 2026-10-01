package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"ghostman/internal/engine"
	"ghostman/internal/session"
	"ghostman/internal/store"
)

// newTestApp wires a real App (SQLite in a temp dir, real session manager and API
// client) to a fake server, logged in with token "tok" when loggedIn is true.
func newTestApp(t *testing.T, loggedIn bool, routes map[string]http.HandlerFunc) *App {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"status":"ok"}`)) })
	mux.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			writeEnvelope(w, 401, "unauthorized", "invalid or expired token")
			return
		}
		_, _ = w.Write([]byte(`{"id":"u1","email":"a@x.io","name":"A"}`))
	})
	for pattern, h := range routes {
		mux.HandleFunc(pattern, h)
	}
	// Sending reads the active environment first; default to "no environments".
	if _, ok := routes["GET /api/v1/projects/{project_id}/environments"]; !ok {
		mux.HandleFunc("GET /api/v1/projects/{project_id}/environments", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[]`))
		})
	}
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	t.Setenv("GHOSTMAN_DB", filepath.Join(t.TempDir(), "app.db"))
	a := NewApp(engine.New(engine.DefaultTimeout), srv.URL)
	if err := a.init(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.store.Close() })
	if loggedIn {
		if err := a.store.PutSetting(context.Background(), store.SettingSessionToken, "tok"); err != nil {
			t.Fatal(err)
		}
	}
	a.session.Check(context.Background())
	return a
}

func writeEnvelope(w http.ResponseWriter, status int, code, msg string) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

func toJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestBoundTeamMethods_DataMapping(t *testing.T) {
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/teams": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"t1","name":"Alpha","member_count":1,"is_owner":true}]`))
		},
		"GET /api/v1/me/invitations": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`[]`)) },
		"POST /api/v1/teams": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"t2","name":"Beta"}`))
		},
		"DELETE /api/v1/teams/{id}": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) },
	})

	if got, want := toJSON(t, a.ListTeams()), `{"data":[{"id":"t1","name":"Alpha","member_count":1,"is_owner":true}]}`; got != want {
		t.Errorf("ListTeams = %s\nwant %s", got, want)
	}
	// An empty list must cross the bridge as [], not null.
	if got, want := toJSON(t, a.ListMyInvitations()), `{"data":[]}`; got != want {
		t.Errorf("ListMyInvitations = %s, want %s", got, want)
	}
	if got, want := toJSON(t, a.CreateTeam("  Beta ")), `{"data":{"id":"t2","name":"Beta"}}`; got != want {
		t.Errorf("CreateTeam = %s, want %s", got, want)
	}
	if got, want := toJSON(t, a.DeleteTeam("t2")), `{}`; got != want {
		t.Errorf("DeleteTeam = %s, want %s", got, want)
	}
}

func TestBoundTeamMethods_ErrorMapping(t *testing.T) {
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"POST /api/v1/teams/{team_id}/invitations": func(w http.ResponseWriter, _ *http.Request) {
			writeEnvelope(w, 409, "conflict", "you cannot invite yourself")
		},
		"GET /api/v1/teams/{id}": func(w http.ResponseWriter, _ *http.Request) {
			writeEnvelope(w, 404, "not_found", "team not found")
		},
	})

	got := toJSON(t, a.CreateInvitation("t1", "a@x.io"))
	want := `{"data":null,"error":{"kind":"server","status":409,"code":"conflict","message":"you cannot invite yourself"}}`
	if got != want {
		t.Errorf("CreateInvitation = %s\nwant %s", got, want)
	}
	got = toJSON(t, a.GetTeam("t9"))
	want = `{"data":null,"error":{"kind":"server","status":404,"code":"not_found","message":"team not found"}}`
	if got != want {
		t.Errorf("GetTeam = %s\nwant %s", got, want)
	}
}

func TestBoundTeamMethods_ExpiredSessionLogsOut(t *testing.T) {
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/teams": func(w http.ResponseWriter, _ *http.Request) {
			writeEnvelope(w, 401, "unauthorized", "invalid or expired token")
		},
	})
	if a.session.State().State != session.StateLoggedIn {
		t.Fatalf("precondition: state = %q", a.session.State().State)
	}
	// Simulate the server revoking the session: /me now rejects the token too.
	if err := a.store.PutSetting(context.Background(), store.SettingSessionToken, "revoked"); err != nil {
		t.Fatal(err)
	}

	res := a.ListTeams()
	if res.Error == nil || res.Error.Status != 401 || res.Data != nil {
		t.Fatalf("ListTeams = %s", toJSON(t, res))
	}
	if st := a.session.State().State; st != session.StateLoggedOut {
		t.Errorf("state after 401 = %q, want logged_out", st)
	}
}

func TestBoundTeamMethods_NotLoggedIn(t *testing.T) {
	a := newTestApp(t, false, nil)
	res := a.ListTeams()
	if res.Error == nil || res.Error.Kind != session.KindInvalid || res.Data != nil {
		t.Fatalf("ListTeams while logged out = %s", toJSON(t, res))
	}
}
