package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/filter"
	"ghostman/internal/session"
)

// Bound webhook capture methods: thin {data, error} wrappers over the API client,
// plus the Go-side pieces of the capture view (polling cursor, body preview,
// jq filter, save, copy as request) and the sidebar panel's local layout.

// CodeHooksNotConfigured marks the server's "webhook capture is not configured"
// 409, so the UI can explain it instead of showing a bare error (the server's
// message stays as it was).
const CodeHooksNotConfigured = "hooks_not_configured"

// maxPollPages bounds one poll: a long backlog is caught up over several polls.
const maxPollPages = 10

type MetaResult struct {
	Data  *api.Meta        `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type WebhookListResult struct {
	Data  []api.Webhook    `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type WebhookResult struct {
	Data  *api.WebhookDetail `json:"data"`
	Error *session.Problem   `json:"error,omitempty"`
}

type CaptureListResult struct {
	Data  []api.CaptureSummary `json:"data"`
	Error *session.Problem     `json:"error,omitempty"`
}

// CaptureDetail is one capture for the detail view. The body is a preview like a
// history response (256 KB, pretty when JSON); a media / binary body is NOT sent
// as text (Media set, Body empty) — it can be saved.
type CaptureDetail struct {
	Summary     api.CaptureSummary   `json:"summary"`
	Headers     []api.CapturedHeader `json:"headers"`
	Body        string               `json:"body"`
	RawBody     string               `json:"raw_body"` // set when Formatted
	Formatted   bool                 `json:"formatted"`
	PreviewCut  bool                 `json:"preview_cut"`  // longer than the 256 KB preview
	StoredBytes int64                `json:"stored_bytes"` // what the server kept (BodyTruncated: less than received)
	Media       string               `json:"media"`
}

type CaptureDetailResult struct {
	Data  *CaptureDetail   `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// WebhookPatchInput is a partial update from the UI: nil / omitted fields are
// left alone (RespHeaders: [] clears, nil keeps).
type WebhookPatchInput struct {
	Name        *string        `json:"name,omitempty"`
	Domain      *string        `json:"domain,omitempty"`
	RespStatus  *int32         `json:"resp_status,omitempty"`
	RespHeaders []api.KeyValue `json:"resp_headers,omitempty"`
	RespBody    *string        `json:"resp_body,omitempty"`
}

// captureCache keeps the capture the detail view shows, so filtering, saving
// and copying neither re-fetch it nor re-parse its body.
type captureCache struct {
	mu        sync.Mutex
	webhookID string
	id        int64
	capture   *api.Capture
	doc       *parsedDoc
}

// hooksProblem is call's problem, with the not-configured 409 marked.
func hooksProblem(p *session.Problem) *session.Problem {
	if p != nil && p.Status == http.StatusConflict && strings.Contains(p.Message, "not configured") {
		p.Code = CodeHooksNotConfigured
	}
	return p
}

// GetWebhookMeta returns the server's capture domains (empty = feature off).
func (a *App) GetWebhookMeta() MetaResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Meta, error) { return c.GetMeta(ctx) })
	return MetaResult{Data: ptr(v, p), Error: p}
}

// ListWebhooks returns the project's endpoints.
func (a *App) ListWebhooks(projectID string) WebhookListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.Webhook, error) {
		return c.ListWebhooks(ctx, projectID)
	})
	return WebhookListResult{Data: v, Error: p}
}

// GetWebhook returns one endpoint with its configured response.
func (a *App) GetWebhook(id string) WebhookResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.WebhookDetail, error) { return c.GetWebhook(ctx, id) })
	return WebhookResult{Data: ptr(v, p), Error: p}
}

// CreateWebhook creates an endpoint on the server's default domain.
func (a *App) CreateWebhook(projectID, name string) WebhookResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.WebhookDetail, error) {
		return c.CreateWebhook(ctx, projectID, api.NewWebhook{Name: strings.TrimSpace(name)})
	})
	return WebhookResult{Data: ptr(v, p), Error: hooksProblem(p)}
}

// UpdateWebhook applies a partial update (rename, domain, configured response).
func (a *App) UpdateWebhook(id string, in WebhookPatchInput) WebhookResult {
	patch := api.WebhookPatch{Domain: in.Domain, RespStatus: in.RespStatus, RespBody: in.RespBody}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		patch.Name = &name
	}
	if in.RespHeaders != nil {
		patch.RespHeaders = &in.RespHeaders
	}
	if in.RespStatus != nil && (*in.RespStatus < 100 || *in.RespStatus > 599) {
		return WebhookResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "status must be between 100 and 599"}}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.WebhookDetail, error) {
		return c.UpdateWebhook(ctx, id, patch)
	})
	return WebhookResult{Data: ptr(v, p), Error: hooksProblem(p)}
}

// DeleteWebhook deletes an endpoint and its captures.
func (a *App) DeleteWebhook(id string) EmptyResult {
	a.forgetCapture(id)
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.DeleteWebhook(ctx, id) })
}

// PollCaptures returns every capture with id > after, oldest first: the
// polling cursor. A backlog is read in pages (at most maxPollPages per poll; the
// next poll continues from the last id).
func (a *App) PollCaptures(id string, after int64) CaptureListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.CaptureSummary, error) {
		out := []api.CaptureSummary{}
		cursor := after
		for range maxPollPages {
			page, err := c.ListCaptures(ctx, id, cursor, api.MaxCapturePage)
			if err != nil {
				return nil, err
			}
			out = append(out, page...)
			if len(page) < api.MaxCapturePage {
				break
			}
			cursor = page[len(page)-1].ID
		}
		return out, nil
	})
	return CaptureListResult{Data: v, Error: p}
}

// ClearCaptures deletes every capture of an endpoint.
func (a *App) ClearCaptures(id string) EmptyResult {
	a.forgetCapture(id)
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.ClearCaptures(ctx, id) })
}

// GetCaptureDetail fetches one capture in full and keeps it Go-side for the
// filter / save / copy actions; the UI receives the preview only.
func (a *App) GetCaptureDetail(webhookID string, captureID int64) CaptureDetailResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Capture, error) {
		return c.GetCapture(ctx, webhookID, captureID)
	})
	if p != nil {
		return CaptureDetailResult{Error: p}
	}
	a.captures.mu.Lock()
	a.captures.webhookID, a.captures.id, a.captures.capture, a.captures.doc = webhookID, captureID, &v, &parsedDoc{}
	a.captures.mu.Unlock()
	return CaptureDetailResult{Data: captureDetail(v)}
}

func captureDetail(c api.Capture) *CaptureDetail {
	d := &CaptureDetail{
		Summary: c.CaptureSummary, Headers: c.Headers, StoredBytes: int64(len(c.Body)),
		Media: engine.MediaKind(c.ContentType, c.Body),
	}
	if len(c.Body) > 0 && d.Media == engine.MediaNone {
		pv := engine.PreviewBody(c.Body, int64(len(c.Body)), c.ContentType)
		d.Body, d.RawBody, d.Formatted, d.PreviewCut = pv.Body, pv.RawBody, pv.Formatted, pv.Truncated
	}
	if len(c.Body) == 0 {
		d.Media = engine.MediaNone
	}
	return d
}

var errCaptureGone = errors.New("this capture no longer exists")

// captureFor returns the capture, from the cache when it is the one shown.
func (a *App) captureFor(webhookID string, captureID int64) (*api.Capture, *parsedDoc, error) {
	a.captures.mu.Lock()
	if a.captures.capture != nil && a.captures.webhookID == webhookID && a.captures.id == captureID {
		c, doc := a.captures.capture, a.captures.doc
		a.captures.mu.Unlock()
		return c, doc, nil
	}
	a.captures.mu.Unlock()
	if r := a.GetCaptureDetail(webhookID, captureID); r.Error != nil {
		if r.Error.Status == http.StatusNotFound {
			return nil, nil, errCaptureGone
		}
		return nil, nil, errors.New(r.Error.Message)
	}
	return a.captureFor(webhookID, captureID)
}

// forgetCapture drops the cached capture of a deleted / cleared endpoint.
func (a *App) forgetCapture(webhookID string) {
	a.captures.mu.Lock()
	if a.captures.webhookID == webhookID {
		a.captures.capture, a.captures.doc = nil, nil
	}
	a.captures.mu.Unlock()
}

func (a *App) captureFilter(webhookID string, captureID int64, query string) (filter.Result, error) {
	c, doc, err := a.captureFor(webhookID, captureID)
	if err != nil {
		return filter.Result{}, err
	}
	parsed, err := doc.get(c.Body)
	if err != nil {
		return filter.Result{}, err
	}
	return filter.Eval(a.ctx, parsed, query)
}

// EvalCaptureFilter runs a jq query over a capture's body.
func (a *App) EvalCaptureFilter(webhookID string, captureID int64, query string) FilterResult {
	if strings.TrimSpace(query) == "" {
		return FilterResult{}
	}
	return toFilterResult(a.captureFilter(webhookID, captureID, query))
}

// WarmCaptureFilter parses the capture's body in the background.
func (a *App) WarmCaptureFilter(webhookID string, captureID int64) {
	go func() {
		if c, doc, err := a.captureFor(webhookID, captureID); err == nil {
			_, _ = doc.get(c.Body)
		}
	}()
}

// CopyCaptureFilteredResult copies the whole filtered result.
func (a *App) CopyCaptureFilteredResult(webhookID string, captureID int64, query string) EmptyResult {
	return a.copyResult(a.captureFilter(webhookID, captureID, query))
}

// SaveCaptureFilteredToFile saves the whole filtered result.
func (a *App) SaveCaptureFilteredToFile(webhookID string, captureID int64, query string) SavedFileResult {
	r, err := a.captureFilter(webhookID, captureID, query)
	return a.saveResult(r, err, a.captureFileName(webhookID))
}

// captureFileName is the endpoint's name for saved files ("capture" if unknown).
func (a *App) captureFileName(webhookID string) string {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.WebhookDetail, error) {
		return c.GetWebhook(ctx, webhookID)
	})
	if p != nil || strings.TrimSpace(v.Name) == "" {
		return "capture"
	}
	return strings.TrimSpace(v.Name) + " capture"
}

// CopyCaptureBody copies a text capture body to the clipboard (the stored bytes).
func (a *App) CopyCaptureBody(webhookID string, captureID int64) EmptyResult {
	c, _, err := a.captureFor(webhookID, captureID)
	if err != nil {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	if engine.MediaKind(c.ContentType, c.Body) != engine.MediaNone {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "not a text body — save it to a file instead"}}
	}
	if err := a.clipboard(a.ctx, string(c.Body)); err != nil {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not copy to the clipboard"}}
	}
	return EmptyResult{}
}

// SaveCaptureBodyToFile saves a capture's stored body (any type) through the
// native save dialog; name = endpoint name + "capture" + an extension by type.
func (a *App) SaveCaptureBodyToFile(webhookID string, captureID int64) SavedFileResult {
	c, _, err := a.captureFor(webhookID, captureID)
	if err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	path, err := a.saveDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save captured body",
		DefaultFilename: responseFileName(a.captureFileName(webhookID), c.ContentType),
	})
	if err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not open the save dialog: " + err.Error()}}
	}
	if path == "" {
		return SavedFileResult{}
	}
	if err := os.WriteFile(path, c.Body, 0o644); err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not write the file: " + err.Error()}}
	}
	slog.Info("capture body saved", "webhook", webhookID, "capture", captureID, "bytes", len(c.Body))
	return SavedFileResult{Data: &SavedFile{Path: path, BytesWritten: int64(len(c.Body)), TruncatedAtCap: c.BodyTruncated}}
}

// CopyCaptureAsRequest creates "<endpoint name> capture" at the project root from
// a capture (api.CaptureDraft: no Host / Content-Length / Connection /
// Accept-Encoding, raw body with the captured Content-Type).
func (a *App) CopyCaptureAsRequest(webhookID string, captureID int64) RequestSummaryResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.RequestSummary, error) {
		return c.CopyCaptureAsRequest(ctx, webhookID, captureID)
	})
	return RequestSummaryResult{Data: ptr(v, p), Error: p}
}
