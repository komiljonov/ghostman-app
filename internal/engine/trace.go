package engine

import (
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/http/httptrace"
	"sync"
	"time"
)

// Hop is one request/response exchange of a send: the initial request, then one
// per followed redirect. Phase timings are in milliseconds; a phase that did not
// happen (a reused connection has no DNS lookup or connect; an IP literal has no
// DNS lookup) is null, never 0. TLS handshake time is part of ConnectMs.
type Hop struct {
	URL        string `json:"url"`
	Method     string `json:"method"`
	Status     int    `json:"status"` // 0 when the hop failed before a response
	StatusText string `json:"status_text"`

	DNSMs      *float64 `json:"dns_ms"`
	ConnectMs  *float64 `json:"connect_ms"`  // TCP connect + TLS handshake
	WaitMs     *float64 `json:"wait_ms"`     // request written → first response byte
	DownloadMs *float64 `json:"download_ms"` // first response byte → body read
	TotalMs    float64  `json:"total_ms"`

	ConnectionReused bool   `json:"connection_reused"`
	RemoteAddr       string `json:"remote_addr"`

	// Set when the hop failed: the phase that was in progress, and why.
	FailedPhase string `json:"failed_phase,omitempty"` // dns | connect | wait | download
	Error       string `json:"error,omitempty"`
}

// Phases of a hop, in order.
const (
	PhaseDNS      = "dns"
	PhaseConnect  = "connect"
	PhaseWait     = "wait"
	PhaseDownload = "download"
)

// hopTrace records one hop's httptrace events. Callbacks may arrive on other
// goroutines (dialing runs concurrently), hence the mutex.
type hopTrace struct {
	mu sync.Mutex

	start                time.Time
	dnsStart, dnsDone    time.Time
	connStart, connDone  time.Time // first connect attempt start, successful (or last) done
	tlsStart, tlsDone    time.Time
	gotConn              time.Time
	wrote                time.Time
	firstByte, bodyDone  time.Time
	reused               bool
	remote               string
	connectErr, dnsError error
}

func newHopTrace() *hopTrace { return &hopTrace{start: time.Now()} }

func (t *hopTrace) set(f func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	f()
}

func (t *hopTrace) clientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { t.set(func() { t.dnsStart = time.Now() }) },
		DNSDone: func(info httptrace.DNSDoneInfo) {
			t.set(func() { t.dnsDone, t.dnsError = time.Now(), info.Err })
		},
		ConnectStart: func(string, string) {
			t.set(func() {
				if t.connStart.IsZero() {
					t.connStart = time.Now() // happy eyeballs may start several attempts
				}
			})
		},
		ConnectDone: func(_, _ string, err error) {
			t.set(func() {
				if err == nil || t.connectErr == nil || t.connDone.IsZero() {
					t.connDone, t.connectErr = time.Now(), err
				}
			})
		},
		TLSHandshakeStart: func() { t.set(func() { t.tlsStart = time.Now() }) },
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			t.set(func() { t.tlsDone = time.Now() })
		},
		GotConn: func(info httptrace.GotConnInfo) {
			t.set(func() {
				t.gotConn, t.reused = time.Now(), info.Reused
				if info.Conn != nil && info.Conn.RemoteAddr() != nil {
					t.remote = info.Conn.RemoteAddr().String()
				}
			})
		},
		WroteRequest:         func(httptrace.WroteRequestInfo) { t.set(func() { t.wrote = time.Now() }) },
		GotFirstResponseByte: func() { t.set(func() { t.firstByte = time.Now() }) },
	}
}

func (t *hopTrace) markBodyDone() { t.set(func() { t.bodyDone = time.Now() }) }

func ms(d time.Duration) *float64 {
	v := float64(d.Microseconds()) / 1000
	v = float64(int64(v*10+0.5)) / 10 // 0.1 ms resolution
	return &v
}

func span(from, to time.Time) *float64 {
	if from.IsZero() || to.IsZero() {
		return nil
	}
	return ms(to.Sub(from))
}

// failedPhase names the phase that was in progress when err happened.
func (t *hopTrace) failedPhase(err error) string {
	var dnsErr *net.DNSError
	switch {
	case !t.firstByte.IsZero():
		return PhaseDownload
	case !t.gotConn.IsZero():
		return PhaseWait // writing the request or waiting for the first byte
	case !t.dnsStart.IsZero() && (t.dnsDone.IsZero() || t.dnsError != nil):
		return PhaseDNS
	case errors.As(err, &dnsErr):
		return PhaseDNS
	default:
		return PhaseConnect
	}
}

// hop turns the recorded events into a Hop. resp is nil when the hop failed.
func (t *hopTrace) hop(req *http.Request, resp *http.Response, err error) Hop {
	t.mu.Lock()
	defer t.mu.Unlock()
	end := time.Now()
	h := Hop{
		URL:              redactURL(req),
		Method:           req.Method,
		DNSMs:            span(t.dnsStart, t.dnsDone),
		ConnectionReused: t.reused,
		RemoteAddr:       t.remote,
	}
	if !t.reused {
		connEnd := t.connDone
		if !t.tlsDone.IsZero() {
			connEnd = t.tlsDone // TLS is folded into connect
		}
		h.ConnectMs = span(t.connStart, connEnd)
	} else {
		h.DNSMs = nil
	}
	h.WaitMs = span(t.wrote, t.firstByte)
	if !t.bodyDone.IsZero() {
		h.DownloadMs = span(t.firstByte, t.bodyDone)
		end = t.bodyDone
	}
	h.TotalMs = *ms(end.Sub(t.start))
	if resp != nil {
		h.Status, h.StatusText = resp.StatusCode, http.StatusText(resp.StatusCode)
	}
	if err != nil {
		h.FailedPhase = t.failedPhase(err)
		h.Error = describeError(err, end.Sub(t.start)).Error()
	}
	return h
}

// redactURL is the hop's URL without a userinfo password.
func redactURL(req *http.Request) string {
	u := *req.URL
	if _, ok := u.User.Password(); ok {
		u.User = nil
	}
	return u.String()
}
