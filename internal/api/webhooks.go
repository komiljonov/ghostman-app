package api

import (
	"context"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

// Webhook capture: a project's endpoints receive requests on a separate capture
// host (https://{domain}/h/{slug} or https://{slug}.{domain}/), answer with the
// endpoint's configured static response and store what they received. The app
// polls ListCaptures with the highest id it has seen.

// MaxCapturePage is the server's largest (and default) capture page.
const MaxCapturePage = 100

// maxCaptureResponse caps reading one full capture: the server stores up to
// 1 MB of body, which is ~1.37 MB as base64, plus the headers.
const maxCaptureResponse = 4 << 20

// Meta is GET /api/v1/meta: server facts the client adapts to.
type Meta struct {
	// HooksDomains are the capture domains in order, the first is the default;
	// empty means webhook capture is off on this server.
	HooksDomains []string `json:"hooks_domains"`
}

// Webhook is one entry of a project's endpoint list. Domain "" means the
// server's default domain.
type Webhook struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	Domain     string `json:"domain"`
	RespStatus int32  `json:"resp_status"`
	CreatedAt  string `json:"created_at"`
}

// WebhookDetail is one endpoint with its configured response.
type WebhookDetail struct {
	ID          string     `json:"id"`
	ProjectID   string     `json:"project_id"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	Domain      string     `json:"domain"`
	RespStatus  int32      `json:"resp_status"`
	RespHeaders []KeyValue `json:"resp_headers"`
	RespBody    string     `json:"resp_body"`
	CreatedBy   string     `json:"created_by"`
	CreatedAt   string     `json:"created_at"`
}

// NewWebhook is the input of CreateWebhook (Domain nil = the default).
type NewWebhook struct {
	Name   string  `json:"name"`
	Domain *string `json:"domain,omitempty"`
}

// WebhookPatch is a partial update: nil fields are left alone.
type WebhookPatch struct {
	Name        *string     `json:"name,omitempty"`
	Domain      *string     `json:"domain,omitempty"`
	RespStatus  *int32      `json:"resp_status,omitempty"`
	RespHeaders *[]KeyValue `json:"resp_headers,omitempty"`
	RespBody    *string     `json:"resp_body,omitempty"`
}

// CaptureSummary is one captured request as the polling list returns it.
type CaptureSummary struct {
	ID            int64  `json:"id"`
	Method        string `json:"method"`
	Path          string `json:"path"`  // what follows /h/{slug} (or the whole path on the subdomain form), "/" at least
	Query         string `json:"query"` // raw, without "?"
	ContentType   string `json:"content_type"`
	BodySize      int64  `json:"body_size"` // as received; Body may be shorter (BodyTruncated)
	BodyTruncated bool   `json:"body_truncated"`
	SourceIP      string `json:"source_ip"`
	ReceivedAt    string `json:"received_at"`
}

// CapturedHeader is one received header, repeated names kept in order (Host first).
type CapturedHeader struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Capture is one captured request in full. Body is base64 on the wire;
// encoding/json decodes it into bytes (nil when empty).
type Capture struct {
	CaptureSummary
	Headers []CapturedHeader `json:"headers"`
	Body    []byte           `json:"body"`
}

func webhookPath(id string) string { return "/api/v1/webhooks/" + url.PathEscape(id) }

// GetMeta returns the server's capabilities (capture domains).
func (c *APIClient) GetMeta(ctx context.Context) (Meta, error) {
	var out Meta
	err := c.do(ctx, http.MethodGet, "/api/v1/meta", nil, &out)
	if out.HooksDomains == nil {
		out.HooksDomains = []string{}
	}
	return out, err
}

// CreateWebhook creates an endpoint (random slug, default response 200).
func (c *APIClient) CreateWebhook(ctx context.Context, projectID string, in NewWebhook) (WebhookDetail, error) {
	var out WebhookDetail
	err := c.do(ctx, http.MethodPost, projectPath(projectID)+"/webhooks", in, &out)
	return out.withDefaults(), err
}

// ListWebhooks returns a project's endpoints.
func (c *APIClient) ListWebhooks(ctx context.Context, projectID string) ([]Webhook, error) {
	out := []Webhook{}
	err := c.do(ctx, http.MethodGet, projectPath(projectID)+"/webhooks", nil, &out)
	return out, err
}

// GetWebhook returns one endpoint with its configured response.
func (c *APIClient) GetWebhook(ctx context.Context, id string) (WebhookDetail, error) {
	var out WebhookDetail
	err := c.do(ctx, http.MethodGet, webhookPath(id), nil, &out)
	return out.withDefaults(), err
}

// UpdateWebhook applies a partial update.
func (c *APIClient) UpdateWebhook(ctx context.Context, id string, patch WebhookPatch) (WebhookDetail, error) {
	if patch.RespHeaders != nil {
		rows := nonNilRows(NormalizeRows(*patch.RespHeaders))
		patch.RespHeaders = &rows
	}
	var out WebhookDetail
	err := c.do(ctx, http.MethodPatch, webhookPath(id), patch, &out)
	return out.withDefaults(), err
}

// DeleteWebhook deletes an endpoint and its captures.
func (c *APIClient) DeleteWebhook(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, webhookPath(id), nil, nil)
}

// ListCaptures returns up to limit captures with id > after, oldest first
// (limit <= 0: the server's default page).
func (c *APIClient) ListCaptures(ctx context.Context, id string, after int64, limit int) ([]CaptureSummary, error) {
	q := url.Values{}
	if after > 0 {
		q.Set("after", strconv.FormatInt(after, 10))
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	path := webhookPath(id) + "/captures"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	out := []CaptureSummary{}
	err := c.do(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

// GetCapture returns one capture with its headers and decoded body.
func (c *APIClient) GetCapture(ctx context.Context, id string, captureID int64) (Capture, error) {
	var out Capture
	err := c.doLimited(ctx, http.MethodGet, webhookPath(id)+"/captures/"+strconv.FormatInt(captureID, 10), nil, &out, maxCaptureResponse)
	if out.Headers == nil {
		out.Headers = []CapturedHeader{}
	}
	return out, err
}

// ClearCaptures deletes every capture of an endpoint.
func (c *APIClient) ClearCaptures(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, webhookPath(id)+"/captures", nil, nil)
}

func (w WebhookDetail) withDefaults() WebhookDetail {
	if w.RespHeaders == nil {
		w.RespHeaders = []KeyValue{}
	}
	return w
}

// CaptureCopySuffix is appended to the endpoint's name for "Copy as request".
const CaptureCopySuffix = " capture"

// editorMethods are the methods a request can have.
var editorMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}

// captureDroppedHeaders are hop-by-hop / transport headers a replayed request
// must not carry verbatim: the engine sets them itself.
var captureDroppedHeaders = map[string]bool{
	"host": true, "content-length": true, "connection": true, "accept-encoding": true,
}

// CaptureDraft composes a request from a capture: URL = the captured path
// (literal), its query as enabled param rows (split on "&", then the first "=",
// verbatim — like the URL bar), the method, the headers except Host /
// Content-Length / Connection / Accept-Encoding, and the body as raw text with
// the captured Content-Type (none when empty). Auth stays inherit: the captured
// headers already carry whatever the sender authenticated with. A method the
// app cannot edit becomes GET.
func CaptureDraft(c Capture) RequestDraft {
	d := RequestDraft{
		Method:      strings.ToUpper(c.Method),
		URL:         c.Path,
		Headers:     []KeyValue{},
		QueryParams: []KeyValue{},
		Body:        RequestBody{Type: BodyNone, Fields: []KeyValue{}},
		Auth:        Auth{Type: AuthInherit},
	}
	if !slices.Contains(editorMethods, d.Method) {
		d.Method = http.MethodGet
	}
	if d.URL == "" {
		d.URL = "/"
	}
	for _, h := range c.Headers {
		if captureDroppedHeaders[strings.ToLower(h.Key)] || strings.TrimSpace(h.Key) == "" {
			continue
		}
		d.Headers = append(d.Headers, KeyValue{Key: h.Key, Value: h.Value, Enabled: true})
	}
	if c.Query != "" {
		for _, pair := range strings.Split(c.Query, "&") {
			if pair == "" {
				continue
			}
			k, v, _ := strings.Cut(pair, "=")
			d.QueryParams = append(d.QueryParams, KeyValue{Key: k, Value: v, Enabled: true})
		}
	}
	if len(c.Body) > 0 {
		d.Body = RequestBody{Type: BodyRaw, ContentType: c.ContentType, Content: string(c.Body), Fields: []KeyValue{}}
		if d.Body.ContentType == "" {
			d.Body.ContentType = "text/plain"
		}
	}
	return d
}

// CopyCaptureAsRequest creates "<endpoint name> capture" at the project root
// from one capture (CaptureDraft), with the duplicate flow's cleanup: a failed
// contents PATCH deletes the half-made request.
func (c *APIClient) CopyCaptureAsRequest(ctx context.Context, webhookID string, captureID int64) (RequestSummary, error) {
	hook, err := c.GetWebhook(ctx, webhookID)
	if err != nil {
		return RequestSummary{}, err
	}
	capture, err := c.GetCapture(ctx, webhookID, captureID)
	if err != nil {
		return RequestSummary{}, err
	}
	return c.CreateRequestFrom(ctx, hook.ProjectID, nil, strings.TrimSpace(hook.Name)+CaptureCopySuffix, CaptureDraft(capture))
}
