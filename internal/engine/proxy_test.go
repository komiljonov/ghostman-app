package engine

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ghostman/internal/testproxy"
)

func TestBypassed(t *testing.T) {
	const list = " localhost, 10.0.0.5 , *.internal.corp,API.Example.com,[::1]"
	for _, tt := range []struct {
		host string
		want bool
	}{
		{"localhost", true},
		{"LOCALHOST", true},
		{"10.0.0.5", true},
		{"10.0.0.6", false},
		{"svc.internal.corp", true},
		{"a.b.internal.corp", true},
		{"internal.corp", false}, // *.suffix never matches the bare domain
		{"evilinternal.corp", false},
		{"api.example.com", true}, // case-insensitive
		{"www.example.com", false},
		{"example.com", false},
		{"::1", true},
		{"api.example.com:8443", true}, // a port is ignored
		{"", false},
	} {
		if got := Bypassed(list, tt.host); got != tt.want {
			t.Errorf("Bypassed(%q) = %v, want %v", tt.host, got, tt.want)
		}
	}
	if Bypassed("", "localhost") || Bypassed(" , ,", "x") {
		t.Error("an empty list bypasses nothing")
	}
}

func TestProxyURLAndValidation(t *testing.T) {
	p := &Proxy{Name: "corp", Type: ProxyHTTPS, Host: "proxy.corp", Port: 8443, Username: "me@corp", Password: "p:ss/w"}
	u := proxyURL(p)
	if u.Scheme != "https" || u.Host != "proxy.corp:8443" || u.User.Username() != "me@corp" {
		t.Fatalf("url = %s", u.Redacted())
	}
	if pw, _ := u.User.Password(); pw != "p:ss/w" {
		t.Fatal("password not carried")
	}
	if noPass := proxyURL(&Proxy{Type: ProxyHTTP, Host: "h", Port: 1, Username: "me"}); noPass.User != nil {
		t.Fatalf("a username without a password must send no credentials, got %q", noPass.User)
	}
	for _, bad := range []*Proxy{{Name: "x", Type: "ftp", Host: "h", Port: 1}, {Name: "x", Type: ProxyHTTP, Port: 1}, {Name: "x", Type: ProxyHTTP, Host: "h", Port: 0}} {
		if validateProxy(bad) == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
	if _, err := proxyTransport(http.DefaultTransport.(*http.Transport), &Proxy{Name: "s", Type: ProxySOCKS5, Host: "h", Port: 1080, Username: "u", Password: "p"}); err != nil {
		t.Fatalf("socks5 transport: %v", err)
	}
}

func startProxy(t *testing.T, user, pass string) (*testproxy.Server, *Proxy) {
	t.Helper()
	s, err := testproxy.Start("127.0.0.1:0", user, pass)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, &Proxy{Name: "fixture", Type: ProxyHTTP, Host: "127.0.0.1", Port: s.Port(), Username: user, Password: pass}
}

func targetServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/final", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, "hello from "+r.URL.Path)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func get(url string) RequestSpec { return RequestSpec{Method: http.MethodGet, URL: url} }

func TestHTTPProxyForwardsAndBypasses(t *testing.T) {
	fx, p := startProxy(t, "", "")
	target := targetServer(t)
	e := New(DefaultTimeout)

	resp, err := e.Send(context.Background(), get(target.URL+"/x"), SendOptions{Proxy: p})
	if err != nil || resp.Body != "hello from /x" {
		t.Fatalf("via proxy: %v %+v", err, resp)
	}
	if log := fx.Log(); len(log) != 1 || log[0] != "GET "+target.URL+"/x" {
		t.Fatalf("fixture log = %v", log)
	}
	if h := resp.Hops[0]; h.Proxy != "fixture ("+p.Addr()+")" || h.RemoteAddr != p.Addr() {
		t.Fatalf("hop proxy %q, remote %q (want the proxy's address)", h.Proxy, h.RemoteAddr)
	}

	// The target's host on the bypass list: direct, the fixture sees nothing.
	byp := *p
	byp.Bypass = "example.org, 127.0.0.1"
	resp, err = e.Send(context.Background(), get(target.URL+"/y"), SendOptions{Proxy: &byp})
	if err != nil || resp.Body != "hello from /y" || resp.Hops[0].Proxy != "" {
		t.Fatalf("bypassed: %v %+v", err, resp)
	}
	if len(fx.Log()) != 1 {
		t.Fatalf("a bypassed send reached the proxy: %v", fx.Log())
	}
}

func TestProxyRedirectHopsKeepTheProxy(t *testing.T) {
	fx, p := startProxy(t, "", "")
	target := targetServer(t)
	resp, err := New(DefaultTimeout).Send(context.Background(), get(target.URL+"/redirect"), SendOptions{Proxy: p, FollowRedirects: true})
	if err != nil || resp.Body != "hello from /final" || len(resp.Hops) != 2 {
		t.Fatalf("redirect: %v %+v", err, resp)
	}
	if log := strings.Join(fx.Log(), "\n"); log != "GET "+target.URL+"/redirect\nGET "+target.URL+"/final" {
		t.Fatalf("fixture log = %s", log)
	}
	for _, h := range resp.Hops {
		if h.Proxy == "" {
			t.Fatalf("hop %s went direct", h.URL)
		}
	}
}

func TestProxyAuth(t *testing.T) {
	fx, p := startProxy(t, "alice", "s3cret:pw")
	target := targetServer(t)
	e := New(DefaultTimeout)
	if resp, err := e.Send(context.Background(), get(target.URL+"/a"), SendOptions{Proxy: p}); err != nil || resp.Status != 200 {
		t.Fatalf("with password: %v %+v", err, resp)
	}
	// Username but no local password: sent without credentials — the proxy refuses.
	noPass := *p
	noPass.Password = ""
	resp, err := e.Send(context.Background(), get(target.URL+"/b"), SendOptions{Proxy: &noPass})
	if err != nil || resp.Status != http.StatusProxyAuthRequired {
		t.Fatalf("without password: %v %+v", err, resp)
	}
	if log := fx.Log(); log[0] != "GET "+target.URL+"/a auth=ok" || log[1] != "GET "+target.URL+"/b auth=missing" {
		t.Fatalf("fixture log = %v", log)
	}
}

func TestHTTPSThroughConnect(t *testing.T) {
	fx, p := startProxy(t, "alice", "pw")
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "tls ok") }))
	t.Cleanup(target.Close)
	e := New(DefaultTimeout)
	// Trust the test server's certificate (the proxy client clones this transport).
	e.client.Transport.(*http.Transport).TLSClientConfig = target.Client().Transport.(*http.Transport).TLSClientConfig
	resp, err := e.Send(context.Background(), get(target.URL+"/s"), SendOptions{Proxy: p})
	if err != nil || resp.Body != "tls ok" {
		t.Fatalf("https via CONNECT: %v %+v", err, resp)
	}
	host := strings.TrimPrefix(target.URL, "https://")
	if log := fx.Log(); len(log) != 1 || log[0] != "CONNECT "+host+" auth=ok" {
		t.Fatalf("fixture log = %v", log)
	}
}

func TestSOCKS5Proxy(t *testing.T) {
	fx, p := startProxy(t, "bob", "pw5")
	p.Type = ProxySOCKS5
	target := targetServer(t)
	resp, err := New(DefaultTimeout).Send(context.Background(), get(target.URL+"/socks"), SendOptions{Proxy: p})
	if err != nil || resp.Body != "hello from /socks" {
		t.Fatalf("socks5: %v %+v", err, resp)
	}
	host := strings.TrimPrefix(target.URL, "http://")
	if log := fx.Log(); len(log) != 1 || log[0] != "SOCKS "+host+" auth=ok" {
		t.Fatalf("fixture log = %v", log)
	}
	// Bypass works for SOCKS too (decided per dial).
	p.Bypass = "127.0.0.1"
	if _, err := New(DefaultTimeout).Send(context.Background(), get(target.URL+"/direct"), SendOptions{Proxy: p}); err != nil || len(fx.Log()) != 1 {
		t.Fatalf("socks bypass: %v, log %v", err, fx.Log())
	}
}

func TestProxyDownIsAProxyConnectFailure(t *testing.T) {
	target := targetServer(t)
	for _, typ := range []string{ProxyHTTP, ProxySOCKS5} {
		fx, p := startProxy(t, "", "")
		p.Type = typ
		_ = fx.Close() // nothing listens there any more
		_, err := New(DefaultTimeout).Send(context.Background(), get(target.URL+"/x"), SendOptions{Proxy: p})
		hops := HopsOf(err)
		if err == nil || len(hops) != 1 || hops[0].FailedPhase != PhaseProxy || !strings.Contains(hops[0].Error, "refused") {
			t.Fatalf("%s proxy down: err %v hops %+v", typ, err, hops)
		}
		if !strings.HasPrefix(err.Error(), "could not connect through the proxy fixture ("+p.Addr()+"): ") {
			t.Fatalf("%s proxy down: message %q", typ, err)
		}
	}
}

// One client per proxy config: connections to the same proxy are reused.
func TestProxyClientsAreCached(t *testing.T) {
	e := New(DefaultTimeout)
	p := &Proxy{Name: "a", Type: ProxyHTTP, Host: "127.0.0.1", Port: 3128}
	c1, _ := e.clientFor(p)
	c2, _ := e.clientFor(&Proxy{Name: "a", Type: ProxyHTTP, Host: "127.0.0.1", Port: 3128})
	c3, _ := e.clientFor(&Proxy{Name: "a", Type: ProxyHTTP, Host: "127.0.0.1", Port: 3129})
	direct, _ := e.clientFor(nil)
	if c1 != c2 || c1 == c3 || direct != e.client {
		t.Fatal("client cache keyed wrongly")
	}
}
