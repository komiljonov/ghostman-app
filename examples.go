package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/session"
)

// Saved response examples (server: request_examples). Bound methods are thin
// {data, error} wrappers over the API client plus the Go-side pieces:
//
//   - Saving: from a request tab's ACTIVE response (the full Go-side body, see
//     responses.go) or from a history entry's stored response. A body over the
//     server's 1 MB cap — or one that was itself cut (the 20 MB retention cap,
//     history_max_response_bytes) — is REFUSED with a message; an example is
//     never silently truncated. Examples sync to the team: the UI says so; no
//     scrubbing is attempted (it would be false comfort).
//   - Viewing: the opened example is kept Go-side (exampleCache), so the UI gets
//     a 256 KB preview like history (pretty JSON, media kind), media streams from
//     /example-media/{id} (history_media.go) and Save to file writes the bytes.
//   - Editing: UpdateExample diffs the UI's next state against that cached copy
//     (the last server state) and PATCHes only what changed; the body travels
//     only when it is text and was edited.

// CodeExampleTooLarge marks the refusal of a body over the example cap.
const CodeExampleTooLarge = "example_too_large"

// exampleCacheSize bounds the examples kept Go-side (each ≤ 1 MB).
const exampleCacheSize = 16

type ExampleListResult struct {
	Data  []api.ExampleSummary `json:"data"`
	Error *session.Problem     `json:"error,omitempty"`
}

// ExampleDetail is one example for the detail view. Body is a preview (256 KB,
// pretty when JSON); a media / binary body is never sent as text (Media set,
// Body empty). Text = the body is editable text (valid UTF-8, not media).
type ExampleDetail struct {
	ID          string         `json:"id"`
	RequestID   string         `json:"request_id"`
	Name        string         `json:"name"`
	Status      int32          `json:"status"`
	Headers     []api.KeyValue `json:"headers"`
	ContentType string         `json:"content_type"`
	BodySize    int32          `json:"body_size"`
	UpdatedAt   string         `json:"updated_at"`
	Body        string         `json:"body"`
	RawBody     string         `json:"raw_body"` // set when Formatted
	Formatted   bool           `json:"formatted"`
	PreviewCut  bool           `json:"preview_cut"`
	Media       string         `json:"media"`
	MediaURL    string         `json:"media_url"` // image / audio / video only
	Text        bool           `json:"text"`
}

type ExampleDetailResult struct {
	Data  *ExampleDetail   `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// ExampleEditBody is an example's whole body as text, for the editor.
type ExampleEditBody struct {
	Text string `json:"text"`
}

type ExampleEditBodyResult struct {
	Data  *ExampleEditBody `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// ExampleInput is the edit form's state. Body nil = not edited here (a binary
// body, or the text was not loaded): it is left alone.
type ExampleInput struct {
	Name        string         `json:"name"`
	Status      int32          `json:"status"`
	Headers     []api.KeyValue `json:"headers"`
	ContentType string         `json:"content_type"`
	Body        *string        `json:"body"`
}

type ExampleSummaryResult struct {
	Data  *api.ExampleSummary `json:"data"`
	Error *session.Problem    `json:"error,omitempty"`
}

// ExampleSource is what "Save as example" saves: a request tab's active
// response (Kind "response", TabID = the request id) or a history entry.
type ExampleSource struct {
	Kind      string `json:"kind"` // response | history
	TabID     string `json:"tab_id"`
	HistoryID int64  `json:"history_id"`
}

// ExampleDraft is what the save dialog starts from.
type ExampleDraft struct {
	RequestID   string `json:"request_id"`
	DefaultName string `json:"default_name"`
	Status      int    `json:"status"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

type ExampleDraftResult struct {
	Data  *ExampleDraft    `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type exampleCache struct {
	mu    sync.Mutex
	byID  map[string]*api.Example
	order []string // oldest first
}

func (c *exampleCache) get(id string) (*api.Example, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.byID[id]
	return e, ok
}

func (c *exampleCache) put(e api.Example) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.byID == nil {
		c.byID = map[string]*api.Example{}
	}
	if _, ok := c.byID[e.ID]; !ok {
		c.order = append(c.order, e.ID)
	}
	c.byID[e.ID] = &e
	for len(c.order) > exampleCacheSize {
		delete(c.byID, c.order[0])
		c.order = c.order[1:]
	}
}

func (c *exampleCache) drop(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.byID, id)
	for i, x := range c.order {
		if x == id {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
}

func (c *exampleCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.byID, c.order = nil, nil
}

func exampleTooLarge() *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Code: CodeExampleTooLarge, Message: api.ErrExampleTooLarge.Error()}
}

func invalidExample(msg string) *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Message: msg}
}

// ListExamples returns a request's examples in order (summaries).
func (a *App) ListExamples(requestID string) ExampleListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.ExampleSummary, error) {
		return c.ListExamples(ctx, requestID)
	})
	return ExampleListResult{Data: v, Error: p}
}

// GetExampleDetail fetches one example in full, keeps it Go-side and returns
// the preview the view renders.
func (a *App) GetExampleDetail(id string) ExampleDetailResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Example, error) { return c.GetExample(ctx, id) })
	if p != nil {
		return ExampleDetailResult{Error: p}
	}
	a.examples.put(v)
	return ExampleDetailResult{Data: exampleDetail(v)}
}

func exampleDetail(e api.Example) *ExampleDetail {
	d := &ExampleDetail{
		ID: e.ID, RequestID: e.RequestID, Name: e.Name, Status: e.Status, Headers: e.Headers,
		ContentType: e.ContentType, BodySize: int32(len(e.Body)), UpdatedAt: e.UpdatedAt, //nolint:gosec // ≤ 1 MB
	}
	if len(e.Body) == 0 {
		d.Text = true // an empty body can be typed into
		return d
	}
	d.Media = engine.MediaKind(e.ContentType, e.Body)
	if d.Media == engine.MediaNone {
		pv := engine.PreviewBody(e.Body, int64(len(e.Body)), e.ContentType)
		d.Body, d.RawBody, d.Formatted, d.PreviewCut = pv.Body, pv.RawBody, pv.Formatted, pv.Truncated
		d.Text = utf8.Valid(e.Body)
	} else if servableMedia(d.Media) {
		d.MediaURL = exampleMediaURL(e.ID, e.UpdatedAt)
	}
	return d
}

func exampleMediaURL(id, version string) string {
	return exampleMediaPrefix + url.PathEscape(id) + "?v=" + url.QueryEscape(version)
}

// exampleFor returns an example from the cache, fetching it when absent.
func (a *App) exampleFor(id string) (*api.Example, *session.Problem) {
	if e, ok := a.examples.get(id); ok {
		return e, nil
	}
	if r := a.GetExampleDetail(id); r.Error != nil {
		return nil, r.Error
	}
	e, ok := a.examples.get(id)
	if !ok {
		return nil, invalidExample("this example no longer exists")
	}
	return e, nil
}

// GetExampleEditBody returns an example's WHOLE body as text for the editor
// (≤ 1 MB). A binary body is not editable as text.
func (a *App) GetExampleEditBody(id string) ExampleEditBodyResult {
	e, p := a.exampleFor(id)
	if p != nil {
		return ExampleEditBodyResult{Error: p}
	}
	if len(e.Body) > 0 && (engine.MediaKind(e.ContentType, e.Body) != engine.MediaNone || !utf8.Valid(e.Body)) {
		return ExampleEditBodyResult{Error: invalidExample("a binary body can't be edited as text — save it to a file")}
	}
	return ExampleEditBodyResult{Data: &ExampleEditBody{Text: string(e.Body)}}
}

// examplePatch is what turning the cached example into next changes.
func examplePatch(cur *api.Example, next ExampleInput) (api.ExamplePatch, *session.Problem) {
	var patch api.ExamplePatch
	if name := strings.TrimSpace(next.Name); name != cur.Name {
		if name == "" {
			return patch, invalidExample("the name can't be empty")
		}
		patch.Name = &name
	}
	if next.Status != cur.Status {
		if next.Status < 100 || next.Status > 599 {
			return patch, invalidExample("status must be between 100 and 599")
		}
		s := next.Status
		patch.Status = &s
	}
	headers := keyedRows(next.Headers)
	if !sameRows(headers, cur.Headers) {
		patch.Headers = &headers
	}
	if ct := strings.TrimSpace(next.ContentType); ct != cur.ContentType {
		patch.ContentType = &ct
	}
	if next.Body != nil && *next.Body != string(cur.Body) {
		if len(*next.Body) > api.MaxExampleBody {
			return patch, exampleTooLarge()
		}
		b := []byte(*next.Body)
		patch.Body = &b
	}
	return patch, nil
}

func keyedRows(rows []api.KeyValue) []api.KeyValue {
	out := make([]api.KeyValue, 0, len(rows))
	for _, r := range rows {
		if strings.TrimSpace(r.Key) != "" {
			out = append(out, r)
		}
	}
	return out
}

func sameRows(a, b []api.KeyValue) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// UpdateExample autosaves the edit form: one PATCH with the fields that differ
// from the last server state (kept Go-side); nothing changed = no request.
func (a *App) UpdateExample(id string, next ExampleInput) ExampleSummaryResult {
	cur, p := a.exampleFor(id)
	if p != nil {
		return ExampleSummaryResult{Error: p}
	}
	patch, p := examplePatch(cur, next)
	if p != nil {
		return ExampleSummaryResult{Error: p}
	}
	if patch.Empty() {
		return ExampleSummaryResult{Data: exampleSummary(*cur)}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Example, error) {
		return c.UpdateExample(ctx, id, patch)
	})
	if p != nil {
		return ExampleSummaryResult{Error: p}
	}
	a.examples.put(v)
	return ExampleSummaryResult{Data: exampleSummary(v)}
}

func exampleSummary(e api.Example) *api.ExampleSummary {
	return &api.ExampleSummary{ID: e.ID, Name: e.Name, Status: e.Status, ContentType: e.ContentType,
		BodySize: int32(len(e.Body)), SortOrder: e.SortOrder, UpdatedAt: e.UpdatedAt} //nolint:gosec // ≤ 1 MB
}

// RenameExample renames an example (the list's inline rename).
func (a *App) RenameExample(id, name string) ExampleSummaryResult {
	name = strings.TrimSpace(name)
	if name == "" {
		return ExampleSummaryResult{Error: invalidExample("the name can't be empty")}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Example, error) {
		return c.UpdateExample(ctx, id, api.ExamplePatch{Name: &name})
	})
	if p != nil {
		return ExampleSummaryResult{Error: p}
	}
	a.examples.put(v)
	return ExampleSummaryResult{Data: exampleSummary(v)}
}

// DeleteExample deletes an example.
func (a *App) DeleteExample(id string) EmptyResult {
	p := callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.DeleteExample(ctx, id) })
	if p.Error == nil {
		a.examples.drop(id)
	}
	return p
}

// MoveExample moves an example one place up (-1) or down (+1) in its request's
// list: the server's full current order with the two swapped.
func (a *App) MoveExample(requestID, id string, delta int) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		list, err := c.ListExamples(ctx, requestID)
		if err != nil {
			return err
		}
		ids := make([]string, len(list))
		at := -1
		for i, e := range list {
			ids[i] = e.ID
			if e.ID == id {
				at = i
			}
		}
		to := at + delta
		if at < 0 || to < 0 || to >= len(ids) {
			return nil // already at the edge, or gone: nothing to do
		}
		ids[at], ids[to] = ids[to], ids[at]
		return c.ReorderExamples(ctx, requestID, ids)
	})
}

// exampleFromSource reads what a source would save.
func (a *App) exampleFromSource(src ExampleSource) (requestID string, ex api.NewExample, p *session.Problem) {
	switch src.Kind {
	case "response":
		b, ok := a.responses.get(src.TabID)
		if !ok {
			return "", ex, invalidExample("there is no response to save — send the request first")
		}
		if b.capped || len(b.data) > api.MaxExampleBody {
			return "", ex, exampleTooLarge()
		}
		ex = api.NewExample{Status: int32(b.status), Headers: headerRows(b.headers), //nolint:gosec // an HTTP status
			ContentType: b.contentType, Body: b.data}
		return src.TabID, ex, nil
	case "history":
		if a.store == nil {
			return "", ex, historyNotFound()
		}
		h, err := a.store.GetHistoryEntry(a.ctx, src.HistoryID)
		if err != nil {
			return "", ex, historyNotFound()
		}
		if h.Error.Valid {
			return "", ex, invalidExample("this request failed — there is no response to save")
		}
		if !h.RequestID.Valid || h.RequestID.String == "" {
			return "", ex, invalidExample("this entry is not linked to a saved request — restore it to a request first")
		}
		if h.RespTruncated != 0 || len(h.RespBody) > api.MaxExampleBody {
			return "", ex, exampleTooLarge()
		}
		headers := unmarshalOr(h.RespHeadersJson, []engine.Header{})
		ex = api.NewExample{Status: int32(h.Status), Headers: headerRows(headers), //nolint:gosec // an HTTP status
			ContentType: historyContentType(h.RespHeadersJson), Body: h.RespBody}
		return h.RequestID.String, ex, nil
	}
	return "", ex, invalidExample("unknown example source")
}

// headerRows are response headers as example rows (all enabled).
func headerRows(hs []engine.Header) []api.KeyValue {
	out := make([]api.KeyValue, 0, len(hs))
	for _, h := range hs {
		out = append(out, api.KeyValue{Key: h.Key, Value: h.Value, Enabled: true})
	}
	return out
}

// PrepareExample is the save dialog's start: the target request, the default
// name ("<status> response") — or the refusal (too large, nothing to save).
func (a *App) PrepareExample(src ExampleSource) ExampleDraftResult {
	requestID, ex, p := a.exampleFromSource(src)
	if p != nil {
		return ExampleDraftResult{Error: p}
	}
	return ExampleDraftResult{Data: &ExampleDraft{
		RequestID: requestID, DefaultName: fmt.Sprintf("%d response", ex.Status), Status: int(ex.Status),
		ContentType: ex.ContentType, Size: int64(len(ex.Body)),
	}}
}

// SaveExample saves a source as a new example named name (at the end of the
// request's list): status, headers (as enabled rows), content type, full body.
func (a *App) SaveExample(src ExampleSource, name string) ExampleSummaryResult {
	requestID, ex, p := a.exampleFromSource(src)
	if p != nil {
		return ExampleSummaryResult{Error: p}
	}
	ex.Name = strings.TrimSpace(name)
	if ex.Name == "" {
		return ExampleSummaryResult{Error: invalidExample("give the example a name")}
	}
	if len(ex.ContentType) > 200 { // the server's cap; a type this long is nonsense anyway
		ex.ContentType = ex.ContentType[:200]
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Example, error) {
		return c.CreateExample(ctx, requestID, ex)
	})
	if p != nil {
		if p.Status == http.StatusNotFound {
			p.Message = "the request this response belongs to no longer exists"
		}
		return ExampleSummaryResult{Error: p}
	}
	slog.Info("example saved", "request", requestID, "example", v.ID, "source", src.Kind, "bytes", len(v.Body))
	a.examples.put(v)
	return ExampleSummaryResult{Data: exampleSummary(v)}
}

// SaveExampleBodyToFile saves an example's body (any type) through the native
// save dialog; name = example name + an extension by type.
func (a *App) SaveExampleBodyToFile(id string) SavedFileResult {
	e, p := a.exampleFor(id)
	if p != nil {
		return SavedFileResult{Error: p}
	}
	path, err := a.saveDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save example body",
		DefaultFilename: responseFileName(e.Name, e.ContentType),
	})
	if err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not open the save dialog: " + err.Error()}}
	}
	if path == "" {
		return SavedFileResult{}
	}
	if err := os.WriteFile(path, e.Body, 0o644); err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not write the file: " + err.Error()}}
	}
	slog.Info("example body saved", "example", id, "bytes", len(e.Body))
	return SavedFileResult{Data: &SavedFile{Path: path, BytesWritten: int64(len(e.Body))}}
}

// serveExampleMedia serves a cached (opened) example's image / audio / video
// body: the example view's Preview. Not opened / not media = 404.
func (a *App) serveExampleMedia(w http.ResponseWriter, r *http.Request) {
	id, err := url.PathUnescape(strings.TrimPrefix(r.URL.Path, exampleMediaPrefix))
	if err != nil || id == "" {
		http.NotFound(w, r)
		return
	}
	e, ok := a.examples.get(id)
	if !ok || !servableMedia(engine.MediaKind(e.ContentType, e.Body)) {
		http.NotFound(w, r)
		return
	}
	serveMedia(w, r, e.ContentType, timeOf(e.UpdatedAt), e.Body)
}

// timeOf parses a server timestamp for Last-Modified (zero when unparsable).
func timeOf(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}
