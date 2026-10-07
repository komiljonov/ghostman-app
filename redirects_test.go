package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/engine"
)

func TestSendHonorsTheLocalFollowRedirectsToggle(t *testing.T) {
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

	if !a.GetFollowRedirects("r1") {
		t.Fatal("default must be on")
	}
	res := a.SendRequest("p1", "r1", draft)
	if res.Error != nil || res.Data.Status != 200 || len(res.Hops) != 2 || res.Hops[0].Status != 302 {
		t.Fatalf("follow on: %+v hops=%d", res.Error, len(res.Hops))
	}

	if r := a.SetFollowRedirects("r1", false); r.Error != nil {
		t.Fatal(r.Error.Message)
	}
	if a.GetFollowRedirects("r1") || !a.GetFollowRedirects("r2") {
		t.Fatal("the toggle is per request")
	}
	res = a.SendRequest("p1", "r1", draft)
	if res.Error != nil || res.Data.Status != 302 || len(res.Hops) != 1 {
		t.Fatalf("follow off: want the 302 itself, got %+v status=%d", res.Error, res.Data.Status)
	}
	// Another request still follows.
	if res = a.SendRequest("p1", "r2", draft); res.Data.Status != 200 {
		t.Fatalf("r2: %d", res.Data.Status)
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
