package engine

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Redirects are followed by the engine itself (the client never auto-follows),
// so every hop has its own trace and the chain is known. The rules mirror
// net/http's Client (Go 1.2x, client.go) exactly:
//   - 301/302/303: the method becomes GET (unless GET/HEAD) and the body is
//     dropped — for good: later hops never send it again;
//   - 307/308: same method, body re-sent;
//   - other statuses, or a 3xx without Location, end the chain;
//   - Location is resolved against the current URL;
//   - headers are copied from the INITIAL request; Authorization, Cookie and the
//     other sensitive headers are dropped once the chain leaves the initial host
//     for a host that is not it or its subdomain (and stay dropped); body headers
//     (Content-Type, ...) go when the body goes;
//   - a custom Host header survives only relative redirects;
//   - Referer is set to the previous URL unless https → http (or set by the user);
//   - at most MaxRequests requests: the 10th response still being a redirect
//     fails with "stopped after 10 redirects".

// MaxRequests is the longest redirect chain, like net/http's default policy.
const MaxRequests = 10

var errTooManyRedirects = errors.New("stopped after 10 redirects")

type redirectChain struct {
	initial        *http.Request
	initialHeader  http.Header
	includeBody    bool // false once a hop dropped the body
	stripSensitive bool // true once the chain left the initial host
}

func newRedirectChain(initial *http.Request) *redirectChain {
	return &redirectChain{initial: initial, initialHeader: initial.Header.Clone(), includeBody: true}
}

// redirectBehavior is net/http's: the next method, and whether resp redirects
// and keeps the body.
func redirectBehavior(method string, status int) (next string, redirect, keepBody bool) {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther:
		if method != http.MethodGet && method != http.MethodHead {
			method = http.MethodGet
		}
		return method, true, false
	case http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return method, true, true
	}
	return method, false, false
}

// next builds the request that follows resp, or returns nil when resp ends the chain.
func (c *redirectChain) next(prev *http.Request, resp *http.Response) (*http.Request, error) {
	method, redirect, keepBody := redirectBehavior(prev.Method, resp.StatusCode)
	if !redirect {
		return nil, nil
	}
	loc := resp.Header.Get("Location")
	if loc == "" {
		return nil, nil // 3xx without Location: show it as the response
	}
	if !keepBody {
		c.includeBody = false
	}
	u, err := prev.URL.Parse(loc)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Location header %q: %w", loc, err)
	}

	req, err := http.NewRequestWithContext(prev.Context(), method, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("invalid redirect: %w", err)
	}
	if prev.Host != "" && prev.Host != prev.URL.Host {
		if lu, _ := url.Parse(loc); lu != nil && !lu.IsAbs() {
			req.Host = prev.Host
		}
	}
	if c.includeBody && c.initial.GetBody != nil {
		if req.Body, err = c.initial.GetBody(); err != nil {
			return nil, err
		}
		req.GetBody, req.ContentLength = c.initial.GetBody, c.initial.ContentLength
	}

	if !c.stripSensitive && c.initial.URL.Host != req.URL.Host && !sameDomainOrSubdomain(c.initial.URL, req.URL) {
		c.stripSensitive = true
	}
	for k, vv := range c.initialHeader {
		sensitive, body := false, false
		switch http.CanonicalHeaderKey(k) {
		case "Authorization", "Www-Authenticate", "Cookie", "Cookie2", "Proxy-Authorization", "Proxy-Authenticate":
			sensitive = true
		case "Content-Encoding", "Content-Language", "Content-Location", "Content-Type":
			body = true
		}
		dropSensitive := sensitive && c.stripSensitive
		dropBody := body && !c.includeBody
		if !dropSensitive && !dropBody {
			req.Header[k] = vv
		}
	}
	if ref := refererFor(prev.URL, req.URL, req.Header.Get("Referer")); ref != "" {
		req.Header.Set("Referer", ref)
	}
	return req, nil
}

// sameDomainOrSubdomain: dest is initial's host or one of its subdomains.
func sameDomainOrSubdomain(initial, dest *url.URL) bool {
	ihost, dhost := strings.ToLower(initial.Hostname()), strings.ToLower(dest.Hostname())
	if dhost == ihost {
		return true
	}
	if strings.ContainsAny(dhost, ":%") { // IPv6 / zone: never a subdomain
		return false
	}
	return strings.HasSuffix(dhost, "."+ihost)
}

func refererFor(last, next *url.URL, explicit string) string {
	if last.Scheme == "https" && next.Scheme == "http" {
		return ""
	}
	if explicit != "" {
		return explicit
	}
	u := *last
	u.User = nil
	return u.String()
}
