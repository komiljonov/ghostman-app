package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

// echo is what the /echo handler saw.
type echo struct {
	Method, Body, ContentType, Auth, Referer, Host string
}

// redirectServer: /r/<code>?to=<url> answers <code> with Location: to;
// /loop/<n> redirects forever; /echo reports the request; /rel/a/b redirects to ../echo.
func redirectServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/r/{code}", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		code, _ := strconv.Atoi(r.PathValue("code"))
		w.Header().Set("Location", r.URL.Query().Get("to"))
		w.WriteHeader(code)
		_, _ = w.Write([]byte("redirecting"))
	})
	mux.HandleFunc("/loop/{n}", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.PathValue("n"))
		http.Redirect(w, r, fmt.Sprintf("/loop/%d", n+1), http.StatusFound)
	})
	mux.HandleFunc("/rel/a/b", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "../../echo?from=rel")
		w.WriteHeader(http.StatusFound)
	})
	mux.HandleFunc("/echo", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.NewEncoder(w).Encode(echo{r.Method, string(b), r.Header.Get("Content-Type"), r.Header.Get("Authorization"), r.Header.Get("Referer"), r.Host})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func sendTo(t *testing.T, e *Engine, spec RequestSpec, follow bool) (*Response, []Hop, error) {
	t.Helper()
	resp, err := e.Send(context.Background(), spec, SendOptions{FollowRedirects: follow})
	if err != nil {
		return nil, HopsOf(err), err
	}
	return resp, resp.Hops, nil
}

func decodeEcho(t *testing.T, resp *Response) echo {
	t.Helper()
	var e echo
	if err := json.Unmarshal([]byte(resp.Body), &e); err != nil {
		t.Fatalf("not an echo body (status %d): %q", resp.Status, resp.Body)
	}
	return e
}

func postSpec(u string) RequestSpec {
	return RequestSpec{Method: "POST", URL: u, Body: Body{Type: BodyRaw, ContentType: "application/json", Content: `{"a":1}`},
		Headers: []Header{{Key: "Authorization", Value: "Bearer s3", Enabled: true}}}
}

func TestRedirect_301_302_303_DowngradeToGETAndDropBody(t *testing.T) {
	srv := redirectServer(t)
	e := New(DefaultTimeout)
	for _, code := range []int{301, 302, 303} {
		resp, hops, err := sendTo(t, e, postSpec(fmt.Sprintf("%s/r/%d?to=/echo", srv.URL, code)), true)
		if err != nil {
			t.Fatal(err)
		}
		got := decodeEcho(t, resp)
		if got.Method != http.MethodGet || got.Body != "" || got.ContentType != "" {
			t.Errorf("%d: want GET without body/content-type, got %+v", code, got)
		}
		if got.Auth != "Bearer s3" { // same host: kept
			t.Errorf("%d: Authorization must survive a same-host redirect, got %q", code, got.Auth)
		}
		if got.Referer != srv.URL+fmt.Sprintf("/r/%d?to=/echo", code) {
			t.Errorf("%d: Referer = %q", code, got.Referer)
		}
		if len(hops) != 2 || hops[0].Status != code || hops[0].Method != http.MethodPost || hops[1].Method != http.MethodGet || hops[1].Status != 200 {
			t.Errorf("%d: hops = %+v", code, hops)
		}
	}
	// GET and HEAD keep their method on 301-303.
	resp, _, err := sendTo(t, e, RequestSpec{Method: "GET", URL: srv.URL + "/r/303?to=/echo"}, true)
	if err != nil || decodeEcho(t, resp).Method != http.MethodGet {
		t.Fatalf("GET on 303: %v", err)
	}
}

func TestRedirect_307_308_KeepMethodAndBody(t *testing.T) {
	srv := redirectServer(t)
	e := New(DefaultTimeout)
	for _, code := range []int{307, 308} {
		resp, hops, err := sendTo(t, e, postSpec(fmt.Sprintf("%s/r/%d?to=/echo", srv.URL, code)), true)
		if err != nil {
			t.Fatal(err)
		}
		got := decodeEcho(t, resp)
		if got.Method != http.MethodPost || got.Body != `{"a":1}` || got.ContentType != "application/json" {
			t.Errorf("%d: want POST with body, got %+v", code, got)
		}
		if len(hops) != 2 || hops[1].Method != http.MethodPost {
			t.Errorf("%d: hops = %+v", code, hops)
		}
	}
}

func TestRedirect_BodyStaysDroppedAfterA302(t *testing.T) {
	srv := redirectServer(t)
	// POST → 302 (drops the body, becomes GET) → 307 (keeps the method: GET, no body).
	to307 := url.QueryEscape("/r/307?to=/echo")
	resp, hops, err := sendTo(t, New(DefaultTimeout), postSpec(srv.URL+"/r/302?to="+to307), true)
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeEcho(t, resp); got.Method != http.MethodGet || got.Body != "" {
		t.Fatalf("got %+v", got)
	}
	if len(hops) != 3 {
		t.Fatalf("hops = %d", len(hops))
	}
}

func TestRedirect_RelativeLocation(t *testing.T) {
	srv := redirectServer(t)
	resp, hops, err := sendTo(t, New(DefaultTimeout), RequestSpec{URL: srv.URL + "/rel/a/b"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != 200 || hops[1].URL != srv.URL+"/echo?from=rel" {
		t.Fatalf("status %d, second hop %q", resp.Status, hops[1].URL)
	}
}

func TestRedirect_AuthorizationDroppedCrossHost(t *testing.T) {
	target := redirectServer(t) // listens on 127.0.0.1
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(target.URL, "http://"))
	origin := redirectServer(t)
	e := New(DefaultTimeout)

	// 127.0.0.1 → localhost: a different host name — Authorization and Cookie go.
	other := url.QueryEscape("http://localhost:" + port + "/echo")
	spec := postSpec(origin.URL + "/r/307?to=" + other)
	spec.Headers = append(spec.Headers, Header{Key: "Cookie", Value: "sid=1", Enabled: true}, Header{Key: "X-Keep", Value: "1", Enabled: true})
	resp, _, err := sendTo(t, e, spec, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeEcho(t, resp); got.Auth != "" || got.Body != `{"a":1}` {
		t.Fatalf("cross-host: Authorization must be dropped (body kept on 307): %+v", got)
	}

	// Same host name, other port: kept (net/http compares host names only).
	same := url.QueryEscape(target.URL + "/echo")
	resp, _, err = sendTo(t, e, postSpec(origin.URL+"/r/307?to="+same), true)
	if err != nil || decodeEcho(t, resp).Auth != "Bearer s3" {
		t.Fatalf("same host name: Authorization must be kept: %v", err)
	}
}

func TestSameDomainOrSubdomain(t *testing.T) {
	u := func(s string) *url.URL { v, _ := url.Parse(s); return v }
	cases := []struct {
		from, to string
		want     bool
	}{
		{"https://example.com/a", "https://example.com:8443/b", true},
		{"https://example.com/a", "https://api.example.com/b", true},
		{"https://Example.COM/a", "https://API.example.com/b", true},
		{"https://api.example.com/a", "https://example.com/b", false},
		{"https://example.com/a", "https://badexample.com/b", false},
		{"https://example.com/a", "https://evil.com/b", false},
		{"http://[::1]:80/a", "http://[::1]:81/b", true},
	}
	for _, c := range cases {
		if got := sameDomainOrSubdomain(u(c.from), u(c.to)); got != c.want {
			t.Errorf("%s → %s = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestRedirect_CapAt10KeepsTheChain(t *testing.T) {
	srv := redirectServer(t)
	_, hops, err := sendTo(t, New(DefaultTimeout), RequestSpec{URL: srv.URL + "/loop/0"}, true)
	if err == nil || err.Error() != "stopped after 10 redirects" {
		t.Fatalf("err = %v", err)
	}
	if len(hops) != MaxRequests {
		t.Fatalf("chain = %d hops, want %d", len(hops), MaxRequests)
	}
	for i, h := range hops {
		if h.Status != 302 || h.FailedPhase != "" || !strings.HasSuffix(h.URL, fmt.Sprintf("/loop/%d", i)) {
			t.Errorf("hop %d = %+v", i, h)
		}
	}
	var se *SendError
	if !errors.As(err, &se) || se.DurationMs < 0 {
		t.Fatal("want a *SendError")
	}
}

func TestRedirect_ToggleOffReturnsThe3xx(t *testing.T) {
	srv := redirectServer(t)
	resp, hops, err := sendTo(t, New(DefaultTimeout), RequestSpec{URL: srv.URL + "/r/302?to=/echo"}, false)
	if err != nil {
		t.Fatal(err)
	}
	loc := ""
	for _, h := range resp.Headers {
		if h.Key == "Location" {
			loc = h.Value
		}
	}
	if resp.Status != 302 || loc != "/echo" || resp.Body != "redirecting" || len(hops) != 1 {
		t.Fatalf("status=%d location=%q body=%q hops=%d", resp.Status, loc, resp.Body, len(hops))
	}
	// A 3xx without Location ends the chain even when following.
	resp, hops, err = sendTo(t, New(DefaultTimeout), RequestSpec{URL: srv.URL + "/r/301"}, true)
	if err != nil || resp.Status != 301 || len(hops) != 1 {
		t.Fatalf("no Location: %v %+v", err, hops)
	}
}

func TestHopTiming_FieldsAndReuse(t *testing.T) {
	srv := redirectServer(t)
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	e := New(DefaultTimeout)

	// localhost: a DNS lookup happens; a fresh connection is made.
	resp, hops, err := sendTo(t, e, RequestSpec{URL: "http://localhost:" + port + "/r/302?to=/echo"}, true)
	if err != nil {
		t.Fatal(err)
	}
	first, second := hops[0], hops[1]
	if first.DNSMs == nil || first.ConnectMs == nil || first.WaitMs == nil || first.DownloadMs == nil || first.ConnectionReused {
		t.Errorf("first hop phases: %+v", first)
	}
	if first.RemoteAddr == "" || first.TotalMs <= 0 {
		t.Errorf("first hop: remote=%q total=%v", first.RemoteAddr, first.TotalMs)
	}
	// The redirect goes over the same keep-alive connection: no DNS, no connect.
	if !second.ConnectionReused || second.DNSMs != nil || second.ConnectMs != nil || second.WaitMs == nil {
		t.Errorf("second hop must reuse the connection: %+v", second)
	}
	if resp.DurationMs < 0 || float64(resp.DurationMs) > first.TotalMs+second.TotalMs+50 {
		t.Errorf("total %d ms vs hops %.1f + %.1f", resp.DurationMs, first.TotalMs, second.TotalMs)
	}

	// A second send on the same engine reuses it too.
	_, hops, err = sendTo(t, e, RequestSpec{URL: "http://localhost:" + port + "/echo"}, true)
	if err != nil || !hops[0].ConnectionReused || hops[0].ConnectMs != nil {
		t.Fatalf("keep-alive reuse across sends: %v %+v", err, hops)
	}

	// An IP literal has no DNS phase at all (null, not 0).
	_, hops, err = sendTo(t, New(DefaultTimeout), RequestSpec{URL: srv.URL + "/echo"}, true)
	if err != nil || hops[0].DNSMs != nil || hops[0].ConnectMs == nil {
		t.Fatalf("IP literal: %v %+v", err, hops)
	}
	raw, _ := json.Marshal(hops[0])
	if !strings.Contains(string(raw), `"dns_ms":null`) {
		t.Fatalf("absent phases must be null in JSON: %s", raw)
	}
}

func TestHopTiming_FailedPhase(t *testing.T) {
	stall := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/partial" {
			w.Header().Set("Content-Length", "1000")
			_, _ = w.Write([]byte("only a little"))
			w.(http.Flusher).Flush()
		}
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	t.Cleanup(stall.Close)

	cases := []struct {
		name, url, phase, msg string
		timeout               time.Duration
	}{
		{"dns", "http://ghostman-no-such-host.invalid/x", PhaseDNS, "could not resolve host", DefaultTimeout},
		{"connect", "http://127.0.0.1:1/x", PhaseConnect, "connection refused", DefaultTimeout},
		{"wait", stall.URL + "/hang", PhaseWait, "timed out", 300 * time.Millisecond},
		{"download", stall.URL + "/partial", PhaseDownload, "timed out", 300 * time.Millisecond},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, hops, err := sendTo(t, New(c.timeout), RequestSpec{URL: c.url}, true)
			if err == nil || !strings.Contains(err.Error(), c.msg) {
				t.Fatalf("err = %v, want %q", err, c.msg)
			}
			if len(hops) != 1 || hops[0].FailedPhase != c.phase || hops[0].Error == "" || hops[0].Status != 0 && c.phase != PhaseDownload {
				t.Fatalf("hops = %+v, want failed phase %q", hops, c.phase)
			}
		})
	}
}

func TestSend_BadURLHasNoHops(t *testing.T) {
	_, hops, err := sendTo(t, New(DefaultTimeout), RequestSpec{URL: "not a url"}, true)
	if err == nil || hops != nil {
		t.Fatalf("err=%v hops=%v", err, hops)
	}
}
