package engine

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	xproxy "golang.org/x/net/proxy"
)

// Proxies. The app resolves WHICH proxy a send uses (the cascading proxy
// setting, resolved in the UI over the tree) and hands the engine its full
// config, the password from local storage included. Each hop decides by its own
// host whether the proxy applies (Bypass), so a redirect to a bypassed host
// goes direct and every other hop keeps the same proxy.
//
//	http / https  → http.Transport.Proxy (an https proxy is reached over TLS);
//	                credentials go as Proxy-Authorization (Basic), also on CONNECT —
//	                only with a username AND a password (else none at all)
//	socks5        → a golang.org/x/net/proxy SOCKS5 dialer (username / password auth)
//
// A hop through a proxy reports the PROXY's address as its remote_addr (that is
// the connection the client made), and a failure reaching or tunnelling
// through the proxy is its own failed phase: PhaseProxy.

// Proxy types.
const (
	ProxyHTTP   = "http"
	ProxyHTTPS  = "https"
	ProxySOCKS5 = "socks5"
)

// PhaseProxy is the failed phase of a hop that could not connect through its
// proxy (it has no timing column of its own).
const PhaseProxy = "proxy"

// Proxy is a resolved proxy for one send. Never logged (Password).
type Proxy struct {
	Name     string
	Type     string // ProxyHTTP | ProxyHTTPS | ProxySOCKS5
	Host     string
	Port     int
	Username string
	Password string
	Bypass   string // comma-separated host patterns (Bypassed)
}

// Addr is host:port of the proxy.
func (p *Proxy) Addr() string { return net.JoinHostPort(p.Host, strconv.Itoa(p.Port)) }

// Label names the proxy for hops and history: `Corp proxy (proxy.corp:3128)`.
func (p *Proxy) Label() string { return fmt.Sprintf("%s (%s)", p.Name, p.Addr()) }

// Bypassed reports whether host goes direct under a bypass list: entries are
// comma-separated and trimmed; "*.example.com" matches any subdomain (a.example.com,
// a.b.example.com) but NOT example.com itself; anything else ("localhost", an
// IP, "api.example.com") matches exactly. Case-insensitive; a port or IPv6
// brackets on host are ignored.
func Bypassed(bypass, host string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	if hh, _, err := net.SplitHostPort(h); err == nil {
		h = hh
	}
	h = strings.Trim(h, "[]")
	if h == "" {
		return false
	}
	for _, raw := range strings.Split(bypass, ",") {
		p := strings.ToLower(strings.TrimSpace(raw))
		if p == "" {
			continue
		}
		if suffix, ok := strings.CutPrefix(p, "*."); ok {
			if suffix != "" && strings.HasSuffix(h, "."+suffix) {
				return true
			}
			continue
		}
		if strings.Trim(p, "[]") == h {
			return true
		}
	}
	return false
}

// hasCredentials: a username AND a password. A username without a local
// password (a teammate's machine) means no credentials are sent at all.
func (p *Proxy) hasCredentials() bool { return p.Username != "" && p.Password != "" }

// proxyURL is the http(s) proxy URL, with credentials when both are set.
func proxyURL(p *Proxy) *url.URL {
	u := &url.URL{Scheme: p.Type, Host: p.Addr()}
	if p.hasCredentials() {
		u.User = url.UserPassword(p.Username, p.Password)
	}
	return u
}

// proxyConnectError marks a failure reaching (or connecting through) a SOCKS5
// proxy; the http transport reports its own as a net.OpError "proxyconnect".
type proxyConnectError struct{ err error }

func (e *proxyConnectError) Error() string { return e.err.Error() }
func (e *proxyConnectError) Unwrap() error { return e.err }

// isProxyConnect reports a failure in the proxy connect phase.
func isProxyConnect(err error) bool {
	var pe *proxyConnectError
	if errors.As(err, &pe) {
		return true
	}
	var op *net.OpError
	return errors.As(err, &op) && op.Op == "proxyconnect"
}

// stripProxyConnect returns the error under a proxy-connect wrapper (the dial
// to the proxy, which names its address), and whether there was one.
func stripProxyConnect(err error) (error, bool) {
	var pe *proxyConnectError
	if errors.As(err, &pe) {
		return pe.err, true
	}
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "proxyconnect" && op.Err != nil {
		return op.Err, true
	}
	return nil, false
}

// validateProxy refuses a config the transport cannot use.
func validateProxy(p *Proxy) error {
	switch p.Type {
	case ProxyHTTP, ProxyHTTPS, ProxySOCKS5:
	default:
		return fmt.Errorf("proxy %q has an unknown type %q", p.Name, p.Type)
	}
	if strings.TrimSpace(p.Host) == "" || p.Port < 1 || p.Port > 65535 {
		return fmt.Errorf("proxy %q needs a host and a port", p.Name)
	}
	return nil
}

// proxyTransport configures a clone of base to go through p.
func proxyTransport(base *http.Transport, p *Proxy) (*http.Transport, error) {
	if err := validateProxy(p); err != nil {
		return nil, err
	}
	t := base.Clone()
	if p.Type != ProxySOCKS5 {
		u := proxyURL(p)
		t.Proxy = func(req *http.Request) (*url.URL, error) {
			if Bypassed(p.Bypass, req.URL.Hostname()) {
				return nil, nil
			}
			return u, nil
		}
		return t, nil
	}
	var auth *xproxy.Auth
	if p.hasCredentials() {
		auth = &xproxy.Auth{User: p.Username, Password: p.Password}
	}
	direct := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	socks, err := xproxy.SOCKS5("tcp", p.Addr(), auth, direct)
	if err != nil {
		return nil, fmt.Errorf("proxy %q: %w", p.Name, err)
	}
	ctxDialer, ok := socks.(xproxy.ContextDialer)
	if !ok {
		return nil, fmt.Errorf("proxy %q: the SOCKS5 dialer cannot be cancelled", p.Name)
	}
	t.Proxy = nil
	t.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, _ := net.SplitHostPort(addr)
		if Bypassed(p.Bypass, host) {
			return direct.DialContext(ctx, network, addr)
		}
		conn, err := ctxDialer.DialContext(ctx, network, addr)
		if err != nil {
			return nil, &proxyConnectError{err}
		}
		return conn, nil
	}
	return t, nil
}

// proxyClients caches one client per distinct proxy config, so sends through
// the same proxy reuse its connections.
type proxyClients struct {
	mu      sync.Mutex
	clients map[Proxy]*http.Client
}

const maxProxyClients = 16

func (e *Engine) clientFor(p *Proxy) (*http.Client, error) {
	if p == nil {
		return e.client, nil
	}
	e.proxies.mu.Lock()
	defer e.proxies.mu.Unlock()
	if c, ok := e.proxies.clients[*p]; ok {
		return c, nil
	}
	base, ok := e.client.Transport.(*http.Transport)
	if !ok {
		return nil, errors.New("the engine's transport cannot be configured for a proxy")
	}
	t, err := proxyTransport(base, p)
	if err != nil {
		return nil, err
	}
	if e.proxies.clients == nil || len(e.proxies.clients) >= maxProxyClients {
		for _, old := range e.proxies.clients {
			old.CloseIdleConnections()
		}
		e.proxies.clients = map[Proxy]*http.Client{}
	}
	c := &http.Client{Transport: t, CheckRedirect: e.client.CheckRedirect}
	e.proxies.clients[*p] = c
	return c, nil
}
