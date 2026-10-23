package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/testproxy"
)

const proxySecret = "hunter2-proxy-pw"

// recordingProxyApp is an app against a fake server that serves one proxy (the
// given fixture, username "alice") and records EVERY request it receives, so a
// test can assert the password never left the machine.
func recordingProxyApp(t *testing.T, fixturePort int) (*App, func() string) {
	t.Helper()
	var mu sync.Mutex
	var seen strings.Builder
	record := func(r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		fmt.Fprintf(&seen, "%s %s %v %s\n", r.Method, r.URL, r.Header, body)
		mu.Unlock()
	}
	proxyJSON := fmt.Sprintf(`{"id":"x1","project_id":"p1","name":"Local squid","proxy_type":"http","host":"127.0.0.1","port":%d,"username":"alice","bypass":"example.org","sort_order":0,"created_at":"c"}`, fixturePort)
	ok := func(body string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			record(r)
			if r.Method == http.MethodDelete {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			_, _ = io.WriteString(w, body)
		}
	}
	a := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/proxies/{id}":           ok(proxyJSON),
		"PATCH /api/v1/proxies/{id}":         ok(proxyJSON),
		"DELETE /api/v1/proxies/{id}":        ok(""),
		"POST /api/v1/projects/{id}/proxies": ok(proxyJSON),
		"GET /api/v1/projects/{id}/proxies":  ok("[" + proxyJSON + "]"),
		"PATCH /api/v1/requests/{id}":        ok(`{"id":"r1","proxy":{"mode":"proxy","proxy_id":"x1"}}`),
		"PATCH /api/v1/folders/{id}":         ok(`{"id":"f1"}`),
	})
	return a, func() string {
		mu.Lock()
		defer mu.Unlock()
		return seen.String()
	}
}

func TestProxyPasswordStaysLocal(t *testing.T) {
	a, seen := recordingProxyApp(t, 3128)
	if r := a.CreateProxy("p1", ProxyInput{Name: "Local squid", ProxyType: "http", Host: "127.0.0.1", Port: 3128, Username: "alice"}); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if r := a.SetProxyPassword("x1", proxySecret); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := a.GetProxyPassword("x1").Data; !got.Set || got.Password != proxySecret {
		t.Fatalf("local password = %+v", got)
	}
	in := ProxyInput{Name: "Local squid", ProxyType: "http", Host: "127.0.0.1", Port: 3128, Username: "alice"}
	next := in
	next.Port = 3129
	if r := a.UpdateProxy("x1", in, next); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if r := a.SetRequestProxy("r1", api.ProxyModeProxy, "x1"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if strings.Contains(seen(), proxySecret) {
		t.Fatalf("the proxy password reached the server:\n%s", seen())
	}
	if !strings.Contains(seen(), "PATCH /api/v1/proxies/x1 ") || !strings.Contains(seen(), `{"port":3129}`) {
		t.Fatalf("update must send only the changed field:\n%s", seen())
	}

	// Deleting the proxy deletes its local password.
	if r := a.DeleteProxy("x1"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if got := a.GetProxyPassword("x1").Data; got.Set {
		t.Fatal("the local password survived the proxy")
	}
}

func TestProxyGlobalDefaultAndValidation(t *testing.T) {
	a := newTestApp(t, false, nil)
	if got := a.GetProxyGlobal("p1"); got != ProxyGlobalNone {
		t.Fatalf("default = %q", got)
	}
	if r := a.SetProxyGlobal("p1", "x1"); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if a.GetProxyGlobal("p1") != "x1" || a.GetProxyGlobal("p2") != ProxyGlobalNone {
		t.Fatal("the global default is per project")
	}
	for _, bad := range []ProxyInput{
		{Name: "", ProxyType: "http", Host: "h", Port: 1},
		{Name: "x", ProxyType: "ftp", Host: "h", Port: 1},
		{Name: "x", ProxyType: "http", Host: " ", Port: 1},
		{Name: "x", ProxyType: "http", Host: "h", Port: 70000},
	} {
		if r := a.CreateProxy("p1", bad); r.Error == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
	if r := a.SetRequestProxy("r1", api.ProxyModeProxy, ""); r.Error == nil {
		t.Error("mode proxy without an id was accepted")
	}
	if r := a.SetRequestProxy("r1", "sideways", ""); r.Error == nil {
		t.Error("an unknown mode was accepted")
	}
}

func TestSendThroughResolvedProxy(t *testing.T) {
	fx, err := testproxy.Start("127.0.0.1:0", "alice", proxySecret)
	if err != nil {
		t.Fatal(err)
	}
	defer fx.Close()
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ok") }))
	defer target.Close()
	a, seen := recordingProxyApp(t, fx.Port())
	draft := api.RequestDraft{Method: "GET", URL: target.URL + "/via", Body: api.RequestBody{Type: api.BodyNone}}

	// No local password: sent without credentials, with the warning.
	res := a.SendRequest("p1", "r1", draft, SendOptions{ProxyID: "x1"})
	if res.Error != nil || res.Data.Status != http.StatusProxyAuthRequired || !strings.Contains(res.ProxyWarning, "proxy password not set on this machine") {
		t.Fatalf("without password: %+v / %q", res.Error, res.ProxyWarning)
	}

	// With the local password: through the proxy, authenticated; no warning.
	a.SetProxyPassword("x1", proxySecret)
	res = a.SendRequest("p1", "r1", draft, SendOptions{ProxyID: "x1"})
	if res.Error != nil || res.Data.Status != 200 || res.ProxyWarning != "" {
		t.Fatalf("with password: %+v %+v %q", res.Error, res.Data, res.ProxyWarning)
	}
	if log := fx.Log(); len(log) != 2 || log[1] != "GET "+target.URL+"/via auth=ok" {
		t.Fatalf("fixture log = %v", log)
	}
	wantLabel := fmt.Sprintf("Local squid (127.0.0.1:%d)", fx.Port())
	if res.Hops[0].Proxy != wantLabel {
		t.Fatalf("hop proxy = %q", res.Hops[0].Proxy)
	}

	// History names the proxy; the password is nowhere in it, nor in any server request.
	rows := historyRows(t, a)
	e := a.GetHistoryEntry(rows[0].ID).Data
	if e.Proxy != wantLabel {
		t.Fatalf("history proxy = %q", e.Proxy)
	}
	raw, _ := a.store.GetHistoryEntry(a.ctx, rows[0].ID)
	if strings.Contains(fmt.Sprintf("%+v", raw), proxySecret) {
		t.Fatal("the proxy password was written to history")
	}
	if strings.Contains(seen(), proxySecret) {
		t.Fatal("the proxy password reached the server")
	}

	// A proxy deleted meanwhile: a readable abort.
	gone := newTestApp(t, true, map[string]http.HandlerFunc{
		"GET /api/v1/proxies/{id}": func(w http.ResponseWriter, _ *http.Request) { writeEnvelope(w, 404, "not_found", "proxy not found") },
	})
	if r := gone.SendRequest("p1", "r1", draft, SendOptions{ProxyID: "x1"}); r.Error == nil || !strings.Contains(r.Error.Message, "no longer exists") {
		t.Fatalf("deleted proxy: %+v", r.Error)
	}
}

func TestFolderSettingsSendsTheProxyOnlyWhenChanged(t *testing.T) {
	a, seen := recordingProxyApp(t, 3128)
	id := "x1"
	saved := FolderSettingsInput{FollowRedirects: "inherit", Auth: api.Auth{Type: api.AuthInherit}, Proxy: api.NodeProxy{Mode: api.ProxyModeInherit}}
	if r := a.SaveFolderSettings("f1", saved, saved); r.Error != nil || strings.Contains(seen(), "PATCH") {
		t.Fatalf("unchanged settings sent a PATCH: %s", seen())
	}
	next := saved
	next.Proxy = api.NodeProxy{Mode: api.ProxyModeProxy, ProxyID: &id}
	if r := a.SaveFolderSettings("f1", saved, next); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if !strings.Contains(seen(), `{"proxy":{"mode":"proxy","proxy_id":"x1"}}`) {
		t.Fatalf("patch = %s", seen())
	}
	next.Proxy = api.NodeProxy{Mode: api.ProxyModeProxy}
	if r := a.SaveFolderSettings("f1", saved, next); r.Error == nil {
		t.Fatal("mode proxy without a proxy was accepted")
	}
}
