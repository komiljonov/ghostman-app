package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/engine"
)

func TestRedirectSettingsDefaultAndOverride(t *testing.T) {
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
	status := func(id string) int {
		t.Helper()
		res := a.SendRequest("p1", id, draft)
		if res.Error != nil {
			t.Fatal(res.Error.Message)
		}
		return res.Data.Status
	}
	set := func(id, mode string) {
		t.Helper()
		if r := a.SetRequestRedirects(id, mode); r.Error != nil {
			t.Fatal(r.Error.Message)
		}
	}

	// Defaults: global on, every request uses it.
	if got := a.GetRequestRedirects("r1"); got != (RedirectSetting{Mode: RedirectsDefault, Default: true, Effective: true}) || !a.GetFollowRedirectsDefault() {
		t.Fatalf("defaults: %+v", got)
	}
	if res := a.SendRequest("p1", "r1", draft); res.Data.Status != 200 || len(res.Hops) != 2 {
		t.Fatalf("follow by default: %d, %d hops", res.Data.Status, len(res.Hops))
	}

	// Per-request override beats the default.
	set("r1", RedirectsNever)
	if got := a.GetRequestRedirects("r1"); got != (RedirectSetting{Mode: RedirectsNever, Default: true, Effective: false}) {
		t.Fatalf("never: %+v", got)
	}
	if status("r1") != 302 || status("r2") != 200 {
		t.Fatal("r1 never follows; r2 still uses the default")
	}

	// Turning the global default off changes untouched requests only.
	if r := a.SetFollowRedirectsDefault(false); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	set("r3", RedirectsAlways)
	if status("r2") != 302 || status("r3") != 200 || status("r1") != 302 {
		t.Fatal("r2 follows the default (off), r3 always follows, r1 never")
	}
	if got := a.GetRequestRedirects("r2"); got != (RedirectSetting{Mode: RedirectsDefault, Default: false, Effective: false}) {
		t.Fatalf("r2: %+v", got)
	}

	// Back to "use the default".
	set("r3", RedirectsDefault)
	if status("r3") != 302 {
		t.Fatal("r3 uses the (off) default again")
	}
	if r := a.SetRequestRedirects("r1", "sometimes"); r.Error == nil || r.Error.Kind != "invalid" {
		t.Fatalf("unknown mode accepted: %+v", r)
	}
}

func TestFailedSendStillReturnsHops(t *testing.T) {
	a := newTestApp(t, true, nil)
	res := a.SendRequest("p1", "r1", api.RequestDraft{Method: "GET", URL: "http://127.0.0.1:1/x"})
	if res.Error == nil || len(res.Hops) != 1 || res.Hops[0].FailedPhase != engine.PhaseConnect {
		t.Fatalf("want one failed hop (connect): %+v %+v", res.Error, res.Hops)
	}
	if res = a.SendRequest("p1", "r1", api.RequestDraft{URL: "not a url"}); res.Hops == nil || len(res.Hops) != 0 {
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
