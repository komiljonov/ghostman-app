package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ghostman/internal/api"
)

func TestSaveRequestSendsOnlyChangedFields(t *testing.T) {
	var patches []string
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"PATCH /api/v1/requests/{id}": func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			patches = append(patches, string(raw))
			_, _ = w.Write([]byte(`{"id":"r1","project_id":"p1","folder_id":null,"name":"R","method":"POST","url":"u",
				"sort_order":0,"created_at":"x","updated_at":"y","headers":null,"query_params":[],"body":{"type":"none"}}`))
		},
	})
	base := api.RequestDraft{Method: "GET", URL: "u", Headers: []api.KeyValue{}, QueryParams: []api.KeyValue{}, Body: api.RequestBody{Type: "none"}}

	// Only a trailing empty row: nothing to save, no request at all.
	noop := base
	noop.Headers = []api.KeyValue{{Enabled: true}}
	if res := a.SaveRequest("r1", base, noop); res.Error != nil || res.Data != nil || len(patches) != 0 {
		t.Fatalf("no-op save = %s, patches %v", toJSON(t, res), patches)
	}

	draft := base
	draft.Method = "POST"
	res := a.SaveRequest("r1", base, draft)
	if res.Error != nil || len(patches) != 1 || patches[0] != `{"method":"POST"}` {
		t.Fatalf("save = %s, patches %v", toJSON(t, res), patches)
	}
	// null lists from the server become [] for the UI.
	if res.Data.Headers == nil || res.Data.Method != http.MethodPost {
		t.Errorf("returned request = %+v", res.Data)
	}
}

func TestSendRequestUsesDraftAndRecordsHistory(t *testing.T) {
	var gotQuery, gotHeader, gotOff string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery, gotHeader, gotOff = r.URL.RawQuery, r.Header.Get("X-On"), r.Header.Get("X-Off")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()

	a := newTestApp(t, true, nil)
	res := a.SendRequest("p1", "r1", api.RequestDraft{
		Method:      "GET",
		URL:         target.URL + "/x?a=1",
		Headers:     []api.KeyValue{{Key: "X-On", Value: "1", Enabled: true}, {Key: "X-Off", Value: "1"}},
		QueryParams: []api.KeyValue{{Key: "b", Value: "2", Enabled: true}, {Key: "b", Value: "3", Enabled: true}},
		Body:        api.RequestBody{Type: "none"},
	}, SendOptions{FollowRedirects: true})
	if res.Error != nil || res.Data.Status != 200 || !res.Data.Formatted {
		t.Fatalf("send = %s", toJSON(t, res))
	}
	if gotQuery != "a=1&b=2&b=3" || gotHeader != "1" || gotOff != "" {
		t.Errorf("server saw query=%q X-On=%q X-Off=%q", gotQuery, gotHeader, gotOff)
	}
	if rows := historyRows(t, a); len(rows) != 1 || rows[0].Status != 200 {
		t.Errorf("history = %+v", rows)
	}

	bad := a.SendRequest("p1", "r1", api.RequestDraft{URL: "not a url"}, SendOptions{FollowRedirects: true})
	if bad.Error == nil || bad.Error.Kind != KindRequest || bad.Data != nil {
		t.Errorf("bad url = %s", toJSON(t, bad))
	}
}

func TestCancelRequest(t *testing.T) {
	var started atomic.Int32
	slow := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		started.Add(1)
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer slow.Close()
	a := newTestApp(t, true, nil)

	go func() {
		for started.Load() == 0 {
			time.Sleep(10 * time.Millisecond)
		}
		a.CancelRequest("r1")
	}()
	res := a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: slow.URL}, SendOptions{FollowRedirects: true})
	if res.Error == nil || res.Error.Message != "request cancelled" {
		t.Fatalf("cancelled send = %s", toJSON(t, res))
	}

	// A second send of the same request cancels the first.
	done := make(chan SendResult)
	go func() {
		done <- a.SendRequest("p1", "r2", api.RequestDraft{Method: "GET", URL: slow.URL}, SendOptions{FollowRedirects: true})
	}()
	for started.Load() < 2 {
		time.Sleep(10 * time.Millisecond)
	}
	go a.SendRequest("p1", "r2", api.RequestDraft{Method: "GET", URL: "not a url"}, SendOptions{FollowRedirects: true})
	if first := <-done; first.Error == nil || first.Error.Message != "request cancelled" {
		t.Fatalf("superseded send = %s", toJSON(t, first))
	}
}

func TestTabsRoundtrip(t *testing.T) {
	a := newTestApp(t, true, nil)
	empty := `{"open":[],"active":{"kind":"","id":""}}`
	if got := toJSON(t, a.GetTabs("p1")); got != empty {
		t.Fatalf("empty = %s", got)
	}
	a.SetTabs("p1", Tabs{
		Open:   []TabRef{{TabRequest, "r1"}, {TabEnv, "e1"}, {TabEnvList, ""}, {TabHistory, ""}, {TabRequest, "r1"}, {"bogus", "x"}, {TabEnv, ""}},
		Active: TabRef{TabEnv, "e1"},
	})
	want := `{"open":[{"kind":"request","id":"r1"},{"kind":"env","id":"e1"},{"kind":"env_list","id":""},{"kind":"history","id":""}],"active":{"kind":"env","id":"e1"}}`
	if got := toJSON(t, a.GetTabs("p1")); got != want {
		t.Fatalf("tabs = %s\nwant %s", got, want)
	}
	if got := toJSON(t, a.GetTabs("p2")); got != empty {
		t.Fatalf("per project = %s", got)
	}
	if err := a.store.PutSetting(a.ctx, tabsKey("p1"), "garbage"); err != nil {
		t.Fatal(err)
	}
	if got := toJSON(t, a.GetTabs("p1")); got != empty {
		t.Fatalf("corrupt = %s", got)
	}
}

func TestTabsLegacyFormatMigrates(t *testing.T) {
	a := newTestApp(t, true, nil)
	// What step 5 stored: bare request ids.
	if err := a.store.PutSetting(a.ctx, tabsKey("p1"), `{"open":["r1","r2"],"active":"r2"}`); err != nil {
		t.Fatal(err)
	}
	want := `{"open":[{"kind":"request","id":"r1"},{"kind":"request","id":"r2"}],"active":{"kind":"request","id":"r2"}}`
	if got := toJSON(t, a.GetTabs("p1")); got != want {
		t.Fatalf("migrated = %s\nwant %s", got, want)
	}
	// The stored value was rewritten in the typed format.
	if raw, _, _ := a.store.Setting(a.ctx, tabsKey("p1")); raw != want {
		t.Fatalf("stored after migration = %s", raw)
	}
	if err := a.store.PutSetting(a.ctx, tabsKey("p1"), `{"open":["r1"],"active":""}`); err != nil {
		t.Fatal(err)
	}
	if got := toJSON(t, a.GetTabs("p1")); got != `{"open":[{"kind":"request","id":"r1"}],"active":{"kind":"","id":""}}` {
		t.Fatalf("legacy without active = %s", got)
	}
}

func TestSendResolvesActiveEnvironmentWithLocalSecrets(t *testing.T) {
	var gotPath, gotAuth, gotQuery string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAuth, gotQuery = r.URL.Path, r.Header.Get("Authorization"), r.URL.RawQuery
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/projects/{project_id}/environments": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"id":"dev","name":"dev","sort_order":0,"created_at":"x"}]`))
		},
		"GET /api/v1/environments/{env_id}/variables": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[
				{"id":"v1","key":"BASE_URL","type":"regular","value":"` + target.URL + `","sort_order":0},
				{"id":"v2","key":"API_TOKEN","type":"secret","value":null,"sort_order":1},
				{"id":"v3","key":"OTHER_SECRET","type":"secret","value":null,"sort_order":2}]`))
		},
	})
	if err := a.store.PutSecret(a.ctx, "dev", "API_TOKEN", "local-token-123"); err != nil {
		t.Fatal(err)
	}
	draft := api.RequestDraft{
		Method:      "GET",
		URL:         "{{BASE_URL}}/anything",
		Headers:     []api.KeyValue{{Key: "Authorization", Value: "Bearer {{API_TOKEN}}", Enabled: true}},
		QueryParams: []api.KeyValue{{Key: "s", Value: "{{OTHER_SECRET}}", Enabled: true}, {Key: "m", Value: "{{missing}}", Enabled: true}},
		Body:        api.RequestBody{Type: "none"},
	}

	// No active environment: everything literal and reported unresolved.
	res := a.SendRequest("p1", "r1", draft, SendOptions{FollowRedirects: true})
	if res.Error == nil || toJSON(t, res.Unresolved) != `["BASE_URL","API_TOKEN","OTHER_SECRET","missing"]` || res.Environment != "" {
		t.Fatalf("without env = %s", toJSON(t, res))
	}

	if r := a.SetActiveEnvironment("p1", "dev"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	res = a.SendRequest("p1", "r1", draft, SendOptions{FollowRedirects: true})
	if res.Error != nil || res.Data.Status != http.StatusNoContent {
		t.Fatalf("send = %s", toJSON(t, res))
	}
	if gotPath != "/anything" || gotAuth != "Bearer local-token-123" {
		t.Errorf("target saw path=%q auth=%q", gotPath, gotAuth)
	}
	// A secret without a local value and an undefined key stay literal and are reported.
	if gotQuery != "s=%7B%7BOTHER_SECRET%7D%7D&m=%7B%7Bmissing%7D%7D" ||
		toJSON(t, res.Unresolved) != `["OTHER_SECRET","missing"]` || res.Environment != "dev" {
		t.Errorf("query=%q unresolved=%v env=%q", gotQuery, res.Unresolved, res.Environment)
	}
	// History keeps the template form and (local-only, deliberately) the resolved one.
	rows := historyRows(t, a)
	if len(rows) == 0 || rows[0].URLTemplate != "{{BASE_URL}}/anything" || !strings.HasPrefix(rows[0].URLResolved, target.URL+"/anything?") {
		t.Errorf("history = %+v", rows)
	}
}
