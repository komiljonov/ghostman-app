package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
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
	res := a.SendRequest("r1", api.RequestDraft{
		Method:      "GET",
		URL:         target.URL + "/x?a=1",
		Headers:     []api.KeyValue{{Key: "X-On", Value: "1", Enabled: true}, {Key: "X-Off", Value: "1"}},
		QueryParams: []api.KeyValue{{Key: "b", Value: "2", Enabled: true}, {Key: "b", Value: "3", Enabled: true}},
		Body:        api.RequestBody{Type: "none"},
	})
	if res.Error != nil || res.Data.Status != 200 || !res.Data.Formatted {
		t.Fatalf("send = %s", toJSON(t, res))
	}
	if gotQuery != "a=1&b=2&b=3" || gotHeader != "1" || gotOff != "" {
		t.Errorf("server saw query=%q X-On=%q X-Off=%q", gotQuery, gotHeader, gotOff)
	}
	rows, err := a.store.ListHistory(context.Background(), 10)
	if err != nil || len(rows) != 1 || rows[0].Status != 200 {
		t.Errorf("history = %+v, %v", rows, err)
	}

	bad := a.SendRequest("r1", api.RequestDraft{URL: "not a url"})
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
	res := a.SendRequest("r1", api.RequestDraft{Method: "GET", URL: slow.URL})
	if res.Error == nil || res.Error.Message != "request cancelled" {
		t.Fatalf("cancelled send = %s", toJSON(t, res))
	}

	// A second send of the same request cancels the first.
	done := make(chan SendResult)
	go func() { done <- a.SendRequest("r2", api.RequestDraft{Method: "GET", URL: slow.URL}) }()
	for started.Load() < 2 {
		time.Sleep(10 * time.Millisecond)
	}
	go a.SendRequest("r2", api.RequestDraft{Method: "GET", URL: "not a url"})
	if first := <-done; first.Error == nil || first.Error.Message != "request cancelled" {
		t.Fatalf("superseded send = %s", toJSON(t, first))
	}
}

func TestTabsRoundtrip(t *testing.T) {
	a := newTestApp(t, true, nil)
	if got := toJSON(t, a.GetTabs("p1")); got != `{"open":[],"active":""}` {
		t.Fatalf("empty = %s", got)
	}
	a.SetTabs("p1", Tabs{Open: []string{"r1", "r2"}, Active: "r2"})
	if got := toJSON(t, a.GetTabs("p1")); got != `{"open":["r1","r2"],"active":"r2"}` {
		t.Fatalf("tabs = %s", got)
	}
	if got := toJSON(t, a.GetTabs("p2")); got != `{"open":[],"active":""}` {
		t.Fatalf("per project = %s", got)
	}
	if err := a.store.PutSetting(a.ctx, tabsKey("p1"), "garbage"); err != nil {
		t.Fatal(err)
	}
	if got := toJSON(t, a.GetTabs("p1")); got != `{"open":[],"active":""}` {
		t.Fatalf("corrupt = %s", got)
	}
}
