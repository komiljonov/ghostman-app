// Package engine executes HTTP requests. It is the product core: everything the
// UI shows about a response is computed here.
package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

const (
	// DefaultTimeout bounds a whole request: connect, send, and reading the body.
	DefaultTimeout = 30 * time.Second
	// MaxBodyPreview is the largest body slice returned to callers. Larger bodies
	// are counted but not held, so multi-MB payloads never cross the Wails bridge.
	MaxBodyPreview = 256 * 1024
)

// Header is a single request or response header.
type Header struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// Body types.
const (
	BodyNone = "none"
	BodyRaw  = "raw"
	BodyForm = "form"
)

// Body is what to send as the request body.
type Body struct {
	Type        string   `json:"type"` // none | raw | form
	ContentType string   `json:"contentType"`
	Content     string   `json:"content"`
	Fields      []Header `json:"fields"` // form fields; only enabled rows with a key are sent
}

// RequestSpec describes a request to send. Only enabled headers/params/fields with
// a non-empty key are used; query params are appended to any query already in URL.
type RequestSpec struct {
	Method      string   `json:"method"`
	URL         string   `json:"url"`
	Headers     []Header `json:"headers"`
	QueryParams []Header `json:"queryParams"`
	Body        Body     `json:"body"`
}

// Response is the result of a completed HTTP exchange (any status code).
type Response struct {
	Status     int      `json:"status"`
	StatusText string   `json:"statusText"`
	Proto      string   `json:"proto"`
	Headers    []Header `json:"headers"`
	DurationMs int64    `json:"durationMs"`
	// BodySize is the full (decoded) body size in bytes, even when Body is truncated.
	BodySize    int64  `json:"bodySize"`
	Body        string `json:"body"`
	Truncated   bool   `json:"truncated"`
	ContentType string `json:"contentType"`
	// Formatted is true when Body was pretty-printed (valid, untruncated JSON).
	Formatted bool `json:"formatted"`
}

// Engine sends requests. It is safe for concurrent use.
type Engine struct {
	client *http.Client
}

// New returns an Engine whose requests are bounded by timeout overall.
func New(timeout time.Duration) *Engine {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = timeout
	return &Engine{client: &http.Client{Transport: transport, Timeout: timeout}}
}

// SendRequest executes spec and returns the response. Transport-level failures
// (bad URL, DNS, refused, timeout) are returned as errors with a human-readable message.
func (e *Engine) SendRequest(ctx context.Context, spec RequestSpec) (*Response, error) {
	req, err := buildRequest(ctx, spec)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, describeError(err, time.Since(start))
	}
	defer resp.Body.Close()

	var preview bytes.Buffer
	n, err := io.Copy(&preview, io.LimitReader(resp.Body, MaxBodyPreview))
	if err == nil {
		// Count (and discard) whatever is left so BodySize reflects the full body.
		var rest int64
		rest, err = io.Copy(io.Discard, resp.Body)
		n += rest
	}
	if err != nil {
		return nil, describeError(err, time.Since(start))
	}
	duration := time.Since(start)

	body := preview.Bytes()
	truncated := n > int64(len(body))
	if truncated {
		body = trimPartialRune(body)
	}

	contentType := resp.Header.Get("Content-Type")
	formatted := false
	if !truncated && isJSONContentType(contentType) {
		if pretty, ok := prettyJSON(body); ok {
			body, formatted = pretty, true
		}
	}

	return &Response{
		Status:      resp.StatusCode,
		StatusText:  http.StatusText(resp.StatusCode),
		Proto:       resp.Proto,
		Headers:     flattenHeaders(resp.Header),
		DurationMs:  duration.Milliseconds(),
		BodySize:    n,
		Body:        string(body),
		Truncated:   truncated,
		ContentType: contentType,
		Formatted:   formatted,
	}, nil
}

func isJSONContentType(ct string) bool {
	ct = strings.ToLower(ct)
	return strings.Contains(ct, "/json") || strings.Contains(ct, "+json")
}

// prettyJSON indents a JSON document. A truncated body is never passed in (it
// would not parse), and output that would grow past twice the preview cap is
// left unformatted so the bridge payload stays bounded.
func prettyJSON(body []byte) ([]byte, bool) {
	var out bytes.Buffer
	if err := json.Indent(&out, body, "", "  "); err != nil || out.Len() > 2*MaxBodyPreview {
		return nil, false
	}
	return out.Bytes(), true
}

func buildRequest(ctx context.Context, spec RequestSpec) (*http.Request, error) {
	method := strings.ToUpper(strings.TrimSpace(spec.Method))
	if method == "" {
		method = http.MethodGet
	}

	raw := strings.TrimSpace(spec.URL)
	if raw == "" {
		return nil, errors.New("enter a URL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", unwrapURLError(err))
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("invalid URL %q: must start with http:// or https://", raw)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("invalid URL %q: missing host", raw)
	}

	appendQuery(u, spec.QueryParams)

	body, bodyContentType := encodeBody(spec.Body)
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}
	for _, h := range enabled(spec.Headers) {
		key := strings.TrimSpace(h.Key)
		if strings.EqualFold(key, "Host") {
			req.Host = h.Value
			continue
		}
		req.Header.Add(key, h.Value)
	}
	// The body's content type applies unless the user set Content-Type explicitly.
	if bodyContentType != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", bodyContentType)
	}
	return req, nil
}

// enabled returns the rows that are enabled and have a key, in order.
func enabled(rows []Header) []Header {
	out := make([]Header, 0, len(rows))
	for _, r := range rows {
		if r.Enabled && strings.TrimSpace(r.Key) != "" {
			out = append(out, r)
		}
	}
	return out
}

// encodePairs percent-encodes rows as k=v&k=v, keeping order and duplicates.
func encodePairs(rows []Header) string {
	parts := make([]string, 0, len(rows))
	for _, r := range rows {
		parts = append(parts, url.QueryEscape(strings.TrimSpace(r.Key))+"="+url.QueryEscape(r.Value))
	}
	return strings.Join(parts, "&")
}

// appendQuery adds the enabled params after whatever query the URL already has
// (which is kept exactly as typed).
func appendQuery(u *url.URL, params []Header) {
	extra := encodePairs(enabled(params))
	switch {
	case extra == "":
	case u.RawQuery == "":
		u.RawQuery = extra
	default:
		u.RawQuery += "&" + extra
	}
}

// encodeBody returns the body reader and the content type it implies.
func encodeBody(b Body) (io.Reader, string) {
	switch b.Type {
	case BodyRaw:
		ct := strings.TrimSpace(b.ContentType)
		if ct == "" {
			ct = "text/plain"
		}
		return strings.NewReader(b.Content), ct
	case BodyForm:
		return strings.NewReader(encodePairs(enabled(b.Fields))), "application/x-www-form-urlencoded"
	default:
		return nil, ""
	}
}

// describeError turns transport errors into messages a user can act on.
func describeError(err error, elapsed time.Duration) error {
	var dnsErr *net.DNSError
	var opErr *net.OpError
	switch {
	case errors.Is(err, context.Canceled):
		return errors.New("request cancelled")
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, os.ErrDeadlineExceeded), isTimeout(err):
		return fmt.Errorf("request timed out after %s", elapsed.Round(time.Millisecond))
	case errors.As(err, &dnsErr):
		return fmt.Errorf("could not resolve host %q", dnsErr.Name)
	case errors.Is(err, syscall.ECONNREFUSED) || isWSARefused(err):
		addr := ""
		if errors.As(err, &opErr) && opErr.Addr != nil {
			addr = " at " + opErr.Addr.String()
		}
		return fmt.Errorf("connection refused%s", addr)
	}
	return fmt.Errorf("request failed: %w", unwrapURLError(err))
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// isWSARefused matches Windows' WSAECONNREFUSED, which syscall.ECONNREFUSED
// does not cover on every Go/Windows combination.
func isWSARefused(err error) bool {
	const wsaeconnrefused = 10061
	var errno syscall.Errno
	return errors.As(err, &errno) && errno == wsaeconnrefused
}

// unwrapURLError drops the `Get "http://...":` prefix *url.Error adds, since
// the UI already shows the method and URL.
func unwrapURLError(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		return uerr.Err
	}
	return err
}

func flattenHeaders(h http.Header) []Header {
	keys := make([]string, 0, len(h))
	for key := range h {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]Header, 0, len(h))
	for _, key := range keys {
		for _, v := range h[key] {
			out = append(out, Header{Key: key, Value: v, Enabled: true})
		}
	}
	return out
}

// trimPartialRune drops a UTF-8 sequence cut in half by truncation.
func trimPartialRune(b []byte) []byte {
	for i := 0; i < utf8.UTFMax && len(b) > 0; i++ {
		r, size := utf8.DecodeLastRune(b)
		if r != utf8.RuneError || size != 1 {
			return b
		}
		b = b[:len(b)-1]
	}
	return b
}
