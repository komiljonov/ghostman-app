// Package engine executes HTTP requests. It is the product core: everything the
// UI shows about a response is computed here.
package engine

import (
	"bytes"
	"context"
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

// RequestSpec describes a request to send.
type RequestSpec struct {
	Method  string   `json:"method"`
	URL     string   `json:"url"`
	Headers []Header `json:"headers"`
	Body    string   `json:"body"`
}

// Response is the result of a completed HTTP exchange (any status code).
type Response struct {
	Status     int      `json:"status"`
	StatusText string   `json:"statusText"`
	Proto      string   `json:"proto"`
	Headers    []Header `json:"headers"`
	DurationMs int64    `json:"durationMs"`
	// BodySize is the full (decoded) body size in bytes, even when Body is truncated.
	BodySize  int64  `json:"bodySize"`
	Body      string `json:"body"`
	Truncated bool   `json:"truncated"`
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

	return &Response{
		Status:     resp.StatusCode,
		StatusText: http.StatusText(resp.StatusCode),
		Proto:      resp.Proto,
		Headers:    flattenHeaders(resp.Header),
		DurationMs: duration.Milliseconds(),
		BodySize:   n,
		Body:       string(body),
		Truncated:  truncated,
	}, nil
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

	var body io.Reader
	if spec.Body != "" {
		body = strings.NewReader(spec.Body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}
	for _, h := range spec.Headers {
		key := strings.TrimSpace(h.Key)
		if !h.Enabled || key == "" {
			continue
		}
		if strings.EqualFold(key, "Host") {
			req.Host = h.Value
			continue
		}
		req.Header.Add(key, h.Value)
	}
	return req, nil
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
