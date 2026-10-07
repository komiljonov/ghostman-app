package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/store"
)

// historyRows lists every entry (all projects, no filter), newest first.
func historyRows(t *testing.T, a *App) []HistorySummary {
	t.Helper()
	res := a.ListHistory(HistoryFilter{Limit: 500})
	if res.Error != nil {
		t.Fatal(res.Error.Message)
	}
	return res.Data.Items
}

func bytesServer(t *testing.T, n int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte(strings.Repeat("x", n)))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestHistoryWritePathTemplateResolvedAndResponse(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Reply", "yes")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/environments": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"dev","name":"Dev","sort_order":0,"created_at":"x"}]`))
		},
		"GET /api/v1/environments/{env_id}/variables": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"v1","key":"BASE_URL","type":"regular","value":"` + target.URL + `","sort_order":0},
				{"id":"v2","key":"TOKEN","type":"secret","value":null,"sort_order":1}]`))
		},
	})
	if err := a.store.PutSecret(a.ctx, "dev", "TOKEN", "s3cret"); err != nil {
		t.Fatal(err)
	}
	if r := a.SetActiveEnvironment("p1", "dev"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	draft := api.RequestDraft{
		Method: "post", URL: "{{BASE_URL}}/items",
		Headers:     []api.KeyValue{{Key: "Authorization", Value: "Bearer {{TOKEN}}", Enabled: true}},
		QueryParams: []api.KeyValue{{Key: "q", Value: "1", Enabled: true}},
		Body:        api.RequestBody{Type: api.BodyRaw, ContentType: "application/json", Content: `{"t":"{{TOKEN}}"}`},
	}
	if res := a.SendRequest("p1", "r1", draft, SendOptions{FollowRedirects: true, RequestName: "Create item"}); res.Error != nil {
		t.Fatal(res.Error.Message)
	}

	rows := historyRows(t, a)
	if len(rows) != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	s := rows[0]
	if s.ProjectID != "p1" || s.RequestID != "r1" || s.RequestName != "Create item" || s.Method != http.MethodPost ||
		s.URLTemplate != "{{BASE_URL}}/items" || s.URLResolved != target.URL+"/items?q=1" || s.EnvName != "Dev" || s.Status != 200 {
		t.Fatalf("summary = %+v", s)
	}
	e := a.GetHistoryEntry(s.ID)
	if e.Error != nil {
		t.Fatal(e.Error.Message)
	}
	d := e.Data
	if d.EnvID != "dev" || toJSON(t, d.Template.Headers) != `[{"key":"Authorization","value":"Bearer {{TOKEN}}","enabled":true}]` ||
		d.Template.Body != `{"t":"{{TOKEN}}"}` || toJSON(t, d.Template.Params) != `[{"key":"q","value":"1","enabled":true}]` {
		t.Errorf("template = %s", toJSON(t, d.Template))
	}
	// Resolved form: as sent, secret included (local-only, deliberately).
	if !strings.Contains(toJSON(t, d.Resolved.Headers), "Bearer s3cret") || d.Resolved.Body != `{"t":"s3cret"}` ||
		!strings.Contains(toJSON(t, d.Resolved.Headers), "application/json") {
		t.Errorf("resolved = %s", toJSON(t, d.Resolved))
	}
	r := d.Response
	if r == nil || r.Status != 200 || !r.Formatted || r.RawBody != `{"ok":true}` || r.BodySize != 11 || r.StoredTruncated ||
		!strings.Contains(toJSON(t, r.Headers), "X-Reply") {
		t.Errorf("response = %s", toJSON(t, r))
	}
	if len(d.Hops) != 1 || d.Hops[0].Status != 200 {
		t.Errorf("hops = %s", toJSON(t, d.Hops))
	}
}

func TestHistoryRecordsFailures(t *testing.T) {
	a := newTestApp(t, true, nil)
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: "http://127.0.0.1:1/x"}, SendOptions{FollowRedirects: true})
	rows := historyRows(t, a)
	if len(rows) != 1 || rows[0].Status != 0 || rows[0].Error == "" {
		t.Fatalf("rows = %+v", rows)
	}
	e := a.GetHistoryEntry(rows[0].ID).Data
	if e.Response != nil || len(e.Hops) != 1 || e.Hops[0].Error == "" {
		t.Fatalf("failed entry = %s", toJSON(t, e))
	}
	if f := a.ListHistory(HistoryFilter{StatusClass: "err"}); len(f.Data.Items) != 1 {
		t.Fatalf("ERR filter = %+v", f.Data)
	}
}

func TestHistoryBodyCapAndTruncatedFlag(t *testing.T) {
	big := bytesServer(t, 2_000_000)
	a := newTestApp(t, true, nil)
	send := func() HistorySummary {
		a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: big.URL}, SendOptions{FollowRedirects: true})
		return historyRows(t, a)[0]
	}
	// Default 10 MB: whole body kept.
	if s := send(); s.RespTruncated || s.RespBodySize != 2_000_000 {
		t.Fatalf("10MB: %+v", s)
	}
	e := a.GetHistoryEntry(historyRows(t, a)[0].ID).Data.Response
	if e.StoredBytes != 2_000_000 || !e.PreviewCut || len(e.Body) > 256*1024 {
		t.Fatalf("stored=%d previewCut=%v preview=%d", e.StoredBytes, e.PreviewCut, len(e.Body))
	}
	// 1 MB: first 1 MB kept, flagged.
	if r := a.SetHistoryMaxResponseBytes(1 << 20); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	s := send()
	if !s.RespTruncated || s.RespBodySize != 2_000_000 {
		t.Fatalf("1MB: %+v", s)
	}
	if e := a.GetHistoryEntry(s.ID).Data.Response; e.StoredBytes != 1<<20 || !e.StoredTruncated {
		t.Fatalf("1MB stored = %d", e.StoredBytes)
	}
	// 0 = unlimited.
	if r := a.SetHistoryMaxResponseBytes(0); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if s := send(); s.RespTruncated {
		t.Fatalf("unlimited: %+v", s)
	}
	if r := a.SetHistoryMaxResponseBytes(12345); r.Error == nil {
		t.Fatal("an unknown cap must be rejected")
	}
}

func TestHistoryBodyCapForEngine(t *testing.T) {
	cases := []struct{ setting, want int64 }{
		{1 << 20, 20 << 20}, {10 << 20, 20 << 20}, {50 << 20, 50 << 20}, {0, -1},
	}
	for _, c := range cases {
		if got := historyBodyCap(store.HistoryLimits{MaxResponseBytes: c.setting}); got != c.want {
			t.Errorf("cap(%d) = %d, want %d", c.setting, got, c.want)
		}
	}
}

func TestHistoryPruneAndMaxEntries(t *testing.T) {
	srv := bytesServer(t, 10)
	a := newTestApp(t, true, nil)
	for range 103 {
		a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: srv.URL}, SendOptions{})
	}
	if n := len(historyRows(t, a)); n != 103 {
		t.Fatalf("rows = %d (default 1000)", n)
	}
	r := a.SetHistoryMaxEntries(100)
	if r.Error != nil || r.Data != 3 {
		t.Fatalf("lowering to 100 = %+v", r)
	}
	newest := historyRows(t, a)[0].ID
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: srv.URL}, SendOptions{})
	rows := historyRows(t, a)
	if len(rows) != 100 || rows[1].ID != newest {
		t.Fatalf("after the 101st send: %d rows", len(rows))
	}
	// 0 = unlimited: nothing pruned.
	if r := a.SetHistoryMaxEntries(0); r.Error != nil || r.Data != 0 {
		t.Fatalf("unlimited = %+v", r)
	}
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: srv.URL}, SendOptions{})
	if n := len(historyRows(t, a)); n != 101 {
		t.Fatalf("unlimited rows = %d", n)
	}
	if r := a.SetHistoryMaxEntries(7); r.Error == nil {
		t.Fatal("an unknown limit must be rejected")
	}
}

func TestHistoryFiltersAndPaging(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/missing" {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ok.Close()
	a := newTestApp(t, true, nil)
	a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: ok.URL + "/users"}, SendOptions{RequestName: "List users"})
	a.SendRequest("p1", "r2", api.RequestDraft{Method: "POST", URL: ok.URL + "/missing"}, SendOptions{})
	a.SendRequest("p2", "r3", api.RequestDraft{Method: "GET", URL: ok.URL + "/other"}, SendOptions{})

	count := func(f HistoryFilter) int {
		res := a.ListHistory(f)
		if res.Error != nil {
			t.Fatal(res.Error.Message)
		}
		return len(res.Data.Items)
	}
	checks := []struct {
		f    HistoryFilter
		want int
	}{
		{HistoryFilter{}, 3},
		{HistoryFilter{ProjectID: "p1"}, 2},
		{HistoryFilter{Method: "post"}, 1},
		{HistoryFilter{StatusClass: "2xx"}, 2},
		{HistoryFilter{StatusClass: "4xx"}, 1},
		{HistoryFilter{StatusClass: "5xx"}, 0},
		{HistoryFilter{Query: "USERS"}, 1},     // url, case-insensitive
		{HistoryFilter{Query: "list user"}, 1}, // request name
		{HistoryFilter{Query: "%"}, 0},         // no wildcards
		{HistoryFilter{ProjectID: "p1", Method: "GET", StatusClass: "2xx", Query: "users"}, 1},
		{HistoryFilter{RequestID: "r2"}, 1},
		{HistoryFilter{RequestID: "r2", StatusClass: "2xx"}, 0},
		{HistoryFilter{RequestID: "gone"}, 0},
	}
	for _, c := range checks {
		if got := count(c.f); got != c.want {
			t.Errorf("%+v: %d rows, want %d", c.f, got, c.want)
		}
	}
	if res := a.ListHistory(HistoryFilter{StatusClass: "6xx"}); res.Error == nil {
		t.Error("unknown status class must be a problem")
	}

	// Pages: keyset cursor from the last item.
	p1 := a.ListHistory(HistoryFilter{Limit: 2}).Data
	if len(p1.Items) != 2 || !p1.HasMore {
		t.Fatalf("page 1 = %+v", p1)
	}
	last := p1.Items[1]
	p2 := a.ListHistory(HistoryFilter{Limit: 2, BeforeCreated: last.CreatedAt, BeforeID: last.ID}).Data
	if len(p2.Items) != 1 || p2.HasMore || p2.Items[0].ID >= last.ID {
		t.Fatalf("page 2 = %+v", p2)
	}
}

func TestHistoryClearScopesDeleteAndStorage(t *testing.T) {
	srv := bytesServer(t, 300_000)
	a := newTestApp(t, true, nil)
	for i := range 6 {
		pid := "p1"
		if i%2 == 1 {
			pid = "p2"
		}
		a.SendRequest(pid, "r1", api.RequestDraft{Method: "GET", URL: srv.URL}, SendOptions{})
	}
	full := a.GetHistoryStorageInfo().Data
	if full.RowCount != 6 || full.TotalBytes < 6*300_000 {
		t.Fatalf("storage = %+v", full)
	}

	// One entry.
	id := historyRows(t, a)[0].ID
	if r := a.DeleteHistoryEntry(id); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if e := a.GetHistoryEntry(id); e.Error == nil {
		t.Fatal("deleted entry still readable")
	}
	// Older than 30 days: none of these.
	if r := a.ClearHistory("older_than_30d", ""); r.Error != nil || r.Data != 0 {
		t.Fatalf("older = %+v", r)
	}
	// Current project.
	if r := a.ClearHistory("current_project", ""); r.Error == nil {
		t.Fatal("current_project without a project must fail")
	}
	if r := a.ClearHistory("current_project", "p1"); r.Error != nil || r.Data != 3 {
		t.Fatalf("project = %+v", r)
	}
	if r := a.ClearHistory("everything", ""); r.Error == nil {
		t.Fatal("unknown scope must fail")
	}
	// All: the database shrinks back (vacuum).
	if r := a.ClearHistory("all", ""); r.Error != nil || r.Data != 2 {
		t.Fatalf("all = %+v", r)
	}
	empty := a.GetHistoryStorageInfo().Data
	if empty.RowCount != 0 || empty.TotalBytes > 300_000 {
		t.Fatalf("after clear: %+v (was %d bytes)", empty, full.TotalBytes)
	}
}

func TestRestoreHistoryEntryCreatesAtRootFromTemplate(t *testing.T) {
	target := bytesServer(t, 1)
	srv := &dupServer{}
	a := newTestApp(t, true, srv.routes())
	draft := api.RequestDraft{
		Method: "PUT", URL: target.URL + "/{{id}}",
		Headers:     []api.KeyValue{{Key: "X-A", Value: "{{v}}", Enabled: true}},
		QueryParams: []api.KeyValue{{Key: "q", Value: "1", Enabled: false}},
		Body:        api.RequestBody{Type: api.BodyRaw, ContentType: "text/plain", Content: "hi {{v}}"},
	}
	a.SendRequest("p1", "r1", draft, SendOptions{RequestName: "Update"})
	id := historyRows(t, a)[0].ID

	res := a.RestoreHistoryEntry(id, "p9")
	if res.Error != nil || res.Data == nil || res.Data.ID != "r2" {
		t.Fatalf("restore = %+v %+v", res.Data, res.Error)
	}
	c := srv.created
	if c["project_id"] != "p9" || c["name"] != "Update (from history)" || c["folder_id"] != nil || c["method"] != "PUT" {
		t.Errorf("create = %v", c)
	}
	p := srv.patched
	if toJSON(t, p["url"]) != toJSON(t, target.URL+"/{{id}}") ||
		toJSON(t, p["headers"]) != `[{"enabled":true,"key":"X-A","value":"{{v}}"}]` ||
		toJSON(t, p["query_params"]) != `[{"enabled":false,"key":"q","value":"1"}]` ||
		toJSON(t, p["body"]) != `{"content":"hi {{v}}","content_type":"text/plain","type":"raw"}` {
		t.Errorf("patch = %v", p)
	}
	if r := a.RestoreHistoryEntry(99999, "p1"); r.Error == nil {
		t.Error("restoring a missing entry must fail")
	}
}

func TestRestoredName(t *testing.T) {
	cases := []struct{ name, method, url, want string }{
		{"Login", "POST", "https://x.io/a", "Login (from history)"},
		{"", "GET", "https://api.x.io/v1/users?x=1", "GET api.x.io/v1/users (from history)"},
		{"", "GET", "{{BASE}}/users", "GET {{BASE}}/users (from history)"},
	}
	for _, c := range cases {
		if got := restoredName(c.name, c.method, c.url); got != c.want {
			t.Errorf("restoredName(%q, %q) = %q, want %q", c.name, c.url, got, c.want)
		}
	}
}
