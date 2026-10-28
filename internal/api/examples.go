package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
)

// Saved response examples: named example responses attached to a request,
// shared with the team (they sync to every member's client). The body is raw
// bytes; encoding/json carries a []byte as standard, padded base64 — exactly
// what the server reads and writes — and a nil body as null / "no body".

// MaxExampleBody is the server's cap on an example body (decoded bytes).
const MaxExampleBody = 1 << 20

// ErrExampleTooLarge is a body over MaxExampleBody, refused before any request:
// examples are never silently truncated.
var ErrExampleTooLarge = errors.New("response too large for an example (1MB limit) — use Save to file")

// ExampleSummary is one row of a request's example list (no headers, no body).
type ExampleSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Status      int32  `json:"status"`
	ContentType string `json:"content_type"`
	BodySize    int32  `json:"body_size"`
	SortOrder   int32  `json:"sort_order"`
	UpdatedAt   string `json:"updated_at"`
}

// Example is one example in full.
type Example struct {
	ID          string     `json:"id"`
	RequestID   string     `json:"request_id"`
	Name        string     `json:"name"`
	Status      int32      `json:"status"`
	Headers     []KeyValue `json:"headers"`
	ContentType string     `json:"content_type"`
	Body        []byte     `json:"body"`
	BodySize    int32      `json:"body_size"`
	SortOrder   int32      `json:"sort_order"`
	CreatedAt   string     `json:"created_at"`
	UpdatedAt   string     `json:"updated_at"`
}

// NewExample is the input of CreateExample.
type NewExample struct {
	Name        string     `json:"name"`
	Status      int32      `json:"status"`
	Headers     []KeyValue `json:"headers"`
	ContentType string     `json:"content_type"`
	Body        []byte     `json:"body"`
}

// ExamplePatch is a partial update; nil fields are left unchanged. Body set to
// an empty slice clears the body.
type ExamplePatch struct {
	Name        *string     `json:"name,omitempty"`
	Status      *int32      `json:"status,omitempty"`
	Headers     *[]KeyValue `json:"headers,omitempty"`
	ContentType *string     `json:"content_type,omitempty"`
	Body        *[]byte     `json:"body,omitempty"`
}

// Empty reports whether the patch changes nothing.
func (p ExamplePatch) Empty() bool {
	return p.Name == nil && p.Status == nil && p.Headers == nil && p.ContentType == nil && p.Body == nil
}

// maxExampleResponse bounds reading one example: a 1 MB body is ~1.37 MB of
// base64, plus headers and the rest.
const maxExampleResponse = 4 << 20

func examplePath(id string) string { return "/api/v1/examples/" + url.PathEscape(id) }

func requestExamplesPath(requestID string) string {
	return "/api/v1/requests/" + url.PathEscape(requestID) + "/examples"
}

// ListExamples returns a request's examples in order, as summaries.
func (c *APIClient) ListExamples(ctx context.Context, requestID string) ([]ExampleSummary, error) {
	out := []ExampleSummary{}
	err := c.do(ctx, http.MethodGet, requestExamplesPath(requestID), nil, &out)
	return out, err
}

// GetExample returns one example, body included.
func (c *APIClient) GetExample(ctx context.Context, id string) (Example, error) {
	var out Example
	err := c.doLimited(ctx, http.MethodGet, examplePath(id), nil, &out, maxExampleResponse)
	return out.withDefaults(), err
}

// CreateExample adds an example at the end of the request's list.
func (c *APIClient) CreateExample(ctx context.Context, requestID string, in NewExample) (Example, error) {
	if len(in.Body) > MaxExampleBody {
		return Example{}, ErrExampleTooLarge
	}
	if in.Headers == nil {
		in.Headers = []KeyValue{}
	}
	var out Example
	err := c.doLimited(ctx, http.MethodPost, requestExamplesPath(requestID), in, &out, maxExampleResponse)
	return out.withDefaults(), err
}

// UpdateExample applies a partial update.
func (c *APIClient) UpdateExample(ctx context.Context, id string, patch ExamplePatch) (Example, error) {
	if patch.Body != nil && len(*patch.Body) > MaxExampleBody {
		return Example{}, ErrExampleTooLarge
	}
	if patch.Body != nil && *patch.Body == nil {
		empty := []byte{} // "" on the wire: clears the body (nil would marshal as null = unchanged)
		patch.Body = &empty
	}
	var out Example
	err := c.doLimited(ctx, http.MethodPatch, examplePath(id), patch, &out, maxExampleResponse)
	return out.withDefaults(), err
}

// DeleteExample deletes an example.
func (c *APIClient) DeleteExample(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, examplePath(id), nil, nil)
}

// ReorderExamples rewrites a request's example order (ids = every example of it).
func (c *APIClient) ReorderExamples(ctx context.Context, requestID string, ids []string) error {
	body := struct {
		RequestID  string   `json:"request_id"`
		ExampleIDs []string `json:"example_ids"`
	}{requestID, ids}
	return c.do(ctx, http.MethodPut, "/api/v1/examples/order", body, nil)
}

func (e Example) withDefaults() Example {
	if e.Headers == nil {
		e.Headers = []KeyValue{}
	}
	return e
}
