package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"syscall"
)

// Server error codes the client relies on (see the server's internal/api/json.go).
const (
	CodeUnauthorized = "unauthorized"
	CodeConflict     = "conflict"
	CodeUnavailable  = "service_unavailable"

	// CodeBadResponse is client-side: the server answered with something that
	// is not the documented JSON shape (e.g. an HTML page from a proxy).
	CodeBadResponse = "bad_response"
)

// ErrServerUnreachable matches any *ServerUnreachableError via errors.Is.
var ErrServerUnreachable = errors.New("server unreachable")

// APIError is an error the server reported through its error envelope:
// {"error": {"code": "...", "message": "..."}}. Message is safe to show users.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string { return e.Message }

// ServerUnreachableError means no HTTP answer was received from the server
// (connection refused, DNS failure, timeout, ...). Error() is a human message.
type ServerUnreachableError struct {
	URL string
	Err error
}

func (e *ServerUnreachableError) Error() string {
	return fmt.Sprintf("cannot reach the server at %s: %s", e.URL, e.Reason())
}

// Reason is a short human explanation of why the server could not be reached.
func (e *ServerUnreachableError) Reason() string {
	var dnsErr *net.DNSError
	switch {
	case isTimeout(e.Err):
		return "it did not respond in time"
	case errors.As(e.Err, &dnsErr):
		return fmt.Sprintf("host %q not found", dnsErr.Name)
	case isConnRefused(e.Err):
		return "connection refused"
	default:
		return "network error"
	}
}

func (e *ServerUnreachableError) Unwrap() error { return e.Err }

func (e *ServerUnreachableError) Is(target error) bool { return target == ErrServerUnreachable }

// IsUnauthorized reports whether err is the server rejecting credentials or a token.
func IsUnauthorized(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusUnauthorized
}

func isConnRefused(err error) bool {
	// 10061 is WSAECONNREFUSED, which syscall.ECONNREFUSED does not match on Windows.
	var errno syscall.Errno
	return errors.Is(err, syscall.ECONNREFUSED) || (errors.As(err, &errno) && errno == 10061)
}

func isTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// parseErrorResponse builds an *APIError from a non-2xx response, falling back to a
// generic message when the body is not the server's envelope.
func parseErrorResponse(status int, body []byte) *APIError {
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && strings.TrimSpace(envelope.Error.Message) != "" {
		return &APIError{Status: status, Code: envelope.Error.Code, Message: envelope.Error.Message}
	}
	return &APIError{
		Status:  status,
		Code:    CodeBadResponse,
		Message: fmt.Sprintf("the server returned an unexpected response (HTTP %d)", status),
	}
}
