package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/store"
)

func TestSendUsesTheResolvedFollowFlag(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			http.Redirect(w, r, "/done", http.StatusFound)
			return
		}
		_, _ = w.Write([]byte("done"))
	}))
	defer target.Close()
	a := newTestApp(t, true, nil)
	draft := api.RequestDraft{Method: "GET", URL: target.URL + "/start"}
	if res := a.SendRequest("p1", "r1", draft, true); res.Error != nil || res.Data.Status != 200 || len(res.Hops) != 2 {
		t.Fatalf("follow: %+v", res.Error)
	}
	if res := a.SendRequest("p1", "r1", draft, false); res.Error != nil || res.Data.Status != 302 || len(res.Hops) != 1 {
		t.Fatalf("don't follow: %+v", res.Error)
	}
}

// settingsServer records PATCH bodies for requests and folders; ids in fail
// answer 500, ids in gone answer 404.
type settingsServer struct {
	mu      sync.Mutex
	patches []string
	fail    map[string]bool
	gone    map[string]bool
}

func (s *settingsServer) routes() map[string]http.HandlerFunc {
	h := func(kind string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			s.mu.Lock()
			defer s.mu.Unlock()
			id := r.PathValue("id")
			if s.gone[id] {
				writeEnvelope(w, http.StatusNotFound, "not_found", "request not found")
				return
			}
			if s.fail[id] {
				writeEnvelope(w, http.StatusInternalServerError, "internal", "boom")
				return
			}
			b, _ := io.ReadAll(r.Body)
			s.patches = append(s.patches, kind+" "+id+" "+string(b))
			_, _ = w.Write([]byte(`{"id":"` + id + `","name":"x","follow_redirects":"on"}`))
		}
	}
	return map[string]http.HandlerFunc{"PATCH /api/v1/requests/{id}": h("request"), "PATCH /api/v1/folders/{id}": h("folder")}
}

func TestSetFollowRedirectsPatchesTheServer(t *testing.T) {
	srv := &settingsServer{}
	a := newTestApp(t, true, srv.routes())
	if r := a.SetRequestFollowRedirects("r1", "global"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if r := a.SetFolderFollowRedirects("f1", "off"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	want := []string{`request r1 {"follow_redirects":"global"}`, `folder f1 {"follow_redirects":"off"}`}
	if strings.Join(srv.patches, "|") != strings.Join(want, "|") {
		t.Fatalf("patches = %v", srv.patches)
	}
	if r := a.SetRequestFollowRedirects("r1", "sometimes"); r.Error == nil || r.Error.Kind != "invalid" {
		t.Fatalf("invalid value accepted: %+v", r.Error)
	}
	if r := a.SetFolderFollowRedirects("f1", ""); r.Error == nil {
		t.Fatal("empty value accepted")
	}
	if len(srv.patches) != 2 {
		t.Fatal("invalid values must not reach the server")
	}
}

func seedLegacy(t *testing.T, a *App, rows map[string]int64) {
	t.Helper()
	for id, v := range rows {
		if err := a.store.PutFollowRedirects(a.ctx, store.PutFollowRedirectsParams{RequestID: id, FollowRedirects: v}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMigrateLegacyRequestSettings(t *testing.T) {
	srv := &settingsServer{gone: map[string]bool{"r-deleted": true}}
	a := newTestApp(t, true, srv.routes())
	seedLegacy(t, a, map[string]int64{"r-always": 1, "r-never": 0, "r-deleted": 1})

	got := a.MigrateLegacyRequestSettings()
	if got.Error != nil || got.Data != (LegacyMigration{Pushed: 2, Dropped: 1}) {
		t.Fatalf("result = %+v %+v", got.Data, got.Error)
	}
	sort.Strings(srv.patches)
	want := []string{`request r-always {"follow_redirects":"on"}`, `request r-never {"follow_redirects":"off"}`}
	if strings.Join(srv.patches, "|") != strings.Join(want, "|") {
		t.Fatalf("patches = %v (old Always -> on, Never -> off)", srv.patches)
	}
	// The table is gone; a second run is a no-op.
	if rows, err := a.store.LegacyRequestSettings(a.ctx); err != nil || len(rows) != 0 {
		t.Fatalf("rows left: %v %v", rows, err)
	}
	if again := a.MigrateLegacyRequestSettings(); again.Data != (LegacyMigration{}) || again.Error != nil || len(srv.patches) != 2 {
		t.Fatalf("second run must do nothing: %+v", again)
	}
}

func TestMigrateLegacyRequestSettingsReportsFailuresOnceWithoutRetrying(t *testing.T) {
	// r2: the server fails; r3: an older server rejects the field (400). Both are
	// just reported — no special case, no retry.
	srv := &settingsServer{fail: map[string]bool{"r2": true}}
	routes := srv.routes()
	patch := routes["PATCH /api/v1/requests/{id}"]
	routes["PATCH /api/v1/requests/{id}"] = func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("id") == "r3" {
			writeEnvelope(w, http.StatusBadRequest, "bad_request", "provide at least one of name, method, url, headers, query_params or body")
			return
		}
		patch(w, r)
	}
	a := newTestApp(t, true, routes)
	seedLegacy(t, a, map[string]int64{"r1": 1, "r2": 0, "r3": 1})

	got := a.MigrateLegacyRequestSettings()
	if got.Data != (LegacyMigration{Pushed: 1, Failed: 2}) || got.Error == nil {
		t.Fatalf("result = %+v %+v", got.Data, got.Error)
	}
	if !strings.HasPrefix(got.Error.Message, "Could not move 2 redirect setting(s) to the server: ") {
		t.Fatalf("message = %q", got.Error.Message)
	}
	// One attempt only: the table is gone, a second run pushes nothing.
	if rows, _ := a.store.LegacyRequestSettings(a.ctx); len(rows) != 0 {
		t.Fatalf("rows left: %+v", rows)
	}
	srv.mu.Lock()
	srv.fail = nil
	srv.mu.Unlock()
	if again := a.MigrateLegacyRequestSettings(); again.Data != (LegacyMigration{}) || again.Error != nil || len(srv.patches) != 1 {
		t.Fatalf("no retry expected: %+v, patches %v", again, srv.patches)
	}
}

func TestLegacyMigrationNeedsALogin(t *testing.T) {
	a := newTestApp(t, false, nil)
	seedLegacy(t, a, map[string]int64{"r1": 0})
	if got := a.MigrateLegacyRequestSettings(); got.Data != (LegacyMigration{}) || got.Error != nil {
		t.Fatalf("logged out: %+v", got)
	}
	if rows, _ := a.store.LegacyRequestSettings(a.ctx); len(rows) != 1 {
		t.Fatal("rows must wait for a login")
	}
}

func TestFailedSendStillReturnsHops(t *testing.T) {
	a := newTestApp(t, true, nil)
	res := a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: "http://127.0.0.1:1/x"}, true)
	if res.Error == nil || len(res.Hops) != 1 || res.Hops[0].FailedPhase != engine.PhaseConnect {
		t.Fatalf("want one failed hop (connect): %+v %+v", res.Error, res.Hops)
	}
	if res = a.SendRequest("p1", "r1", api.RequestDraft{URL: "not a url"}, true); res.Hops == nil || len(res.Hops) != 0 {
		t.Fatalf("nothing sent: hops must be an empty list, got %v", res.Hops)
	}
}

func TestMaskSecretsInHopURLs(t *testing.T) {
	hops := []engine.Hop{
		{URL: "https://api.example.com/v1?token=s3cr%2Ft+x&q=1"},
		{URL: "https://api.example.com/s3cr%2Ft%20x/next?k=s3cr/t x"},
	}
	got := maskSecrets(hops, []string{"s3cr/t x"})
	for _, h := range got {
		if strings.Contains(h.URL, "s3cr") {
			t.Errorf("secret still visible: %s", h.URL)
		}
	}
	if got[0].URL != "https://api.example.com/v1?token=••••&q=1" {
		t.Errorf("query form: %s", got[0].URL)
	}
	if out := maskSecrets([]engine.Hop{{URL: "https://x"}}, nil); out[0].URL != "https://x" {
		t.Error("no secrets: unchanged")
	}
}
