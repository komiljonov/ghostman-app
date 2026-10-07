package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/session"
	"ghostman/internal/store"
)

// Local history (this machine only, never synced). Every send — success or
// failure — is written here at the end of SendRequest from data Go already has:
// the request in TEMPLATE form (as authored, {{vars}}) and RESOLVED form (as sent,
// secret values included — a deliberate local-only decision, see README), the
// response (body up to history_max_response_bytes) and the per-hop timings.
// The list endpoint returns summary columns only; bodies are read per entry and
// cross the bridge as a 256 KB preview at most.

// historyRecord is one finished send.
type historyRecord struct {
	projectID, requestID, requestName string
	envID, envName                    string
	draft                             api.RequestDraft   // template form
	template, resolved                engine.RequestSpec // template / resolved spec
	auth                              *api.Auth          // effective auth config, template form
	authSource                        string
	resp                              *engine.Response // nil when the send failed
	err                               error
	start                             time.Time
}

func jsonText(v any) sql.NullString {
	b, err := json.Marshal(v)
	if err != nil {
		return sql.NullString{}
	}
	return sql.NullString{String: string(b), Valid: true}
}

func nullText(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }

// historyBodyCap is the engine's Go-side body cap for a send: at least 20 MB (Save
// to file), more when history keeps more, none when history keeps whole bodies.
func historyBodyCap(limits store.HistoryLimits) int64 {
	if limits.MaxResponseBytes == 0 {
		return -1
	}
	return max(int64(engine.MaxFullBody), limits.MaxResponseBytes)
}

func (a *App) recordHistory(r historyRecord) {
	method := strings.ToUpper(strings.TrimSpace(r.template.Method))
	if method == "" {
		method = "GET"
	}
	entry := store.InsertHistoryParams{
		CreatedAt:   r.start.UnixMilli(),
		ProjectID:   nullText(r.projectID),
		RequestID:   nullText(r.requestID),
		RequestName: nullText(r.requestName),
		Method:      method,
		UrlTemplate: strings.TrimSpace(r.template.URL),
		UrlResolved: nullText(engine.SentURL(r.resolved)),
		EnvID:       nullText(r.envID),
		EnvName:     nullText(r.envName),

		ReqHeadersJson: jsonText(nonNilKV(r.draft.Headers)),
		ReqParamsJson:  jsonText(nonNilKV(r.draft.QueryParams)),
		ReqBodyJson:    jsonText(r.draft.Body),

		ReqHeadersResolvedJson: jsonText(engine.SentHeaders(r.resolved)),
	}
	if r.auth != nil {
		entry.ReqAuthJson = jsonText(historyAuth{Config: api.NormalizeAuth(*r.auth), Source: r.authSource})
	}
	if body, _ := engine.SentBody(r.resolved.Body); body != "" {
		entry.ReqBodyResolved = nullText(body)
	}
	if r.err != nil {
		entry.DurationMs = time.Since(r.start).Milliseconds()
		entry.Error = nullText(r.err.Error())
		entry.TimingsJson = jsonText(nonNilHops(engine.HopsOf(r.err)))
		slog.Info("request failed", "method", entry.Method, "url", entry.UrlTemplate, "err", r.err)
	} else {
		entry.Status = int64(r.resp.Status)
		entry.DurationMs = r.resp.DurationMs
		entry.RespHeadersJson = jsonText(r.resp.Headers)
		entry.RespBodySize = r.resp.BodySize
		entry.TimingsJson = jsonText(nonNilHops(r.resp.Hops))
		slog.Info("request sent", "method", entry.Method, "url", entry.UrlTemplate, "status", r.resp.Status, "duration_ms", r.resp.DurationMs)
	}
	if entry.UrlTemplate == "" || a.store == nil {
		return
	}
	if r.resp != nil {
		body := r.resp.Full
		if limit := a.store.HistoryLimits(a.ctx).MaxResponseBytes; limit > 0 && int64(len(body)) > limit {
			body = body[:limit]
		}
		entry.RespBody = body
		if int64(len(body)) < r.resp.BodySize {
			entry.RespTruncated = 1
		}
	}
	// History is best-effort: a DB problem must not hide the response.
	if _, err := a.store.AddHistory(a.ctx, entry); err != nil {
		slog.Error("record history", "err", err)
	}
}

func nonNilKV(rows []api.KeyValue) []api.KeyValue {
	if rows == nil {
		return []api.KeyValue{}
	}
	return rows
}

// ---- Bound methods ----

// HistoryFilter is one page request of the History tab. Everything is applied in SQL.
type HistoryFilter struct {
	ProjectID     string `json:"project_id"`   // "" = every project
	RequestID     string `json:"request_id"`   // "" = every request (else one request's sends)
	Query         string `json:"query"`        // substring of url / request name ("" = any)
	Method        string `json:"method"`       // "" = any
	StatusClass   string `json:"status_class"` // "" | 2xx | 3xx | 4xx | 5xx | err
	BeforeCreated int64  `json:"before_created"`
	BeforeID      int64  `json:"before_id"` // cursor: the last item of the previous page (0 = newest)
	Limit         int64  `json:"limit"`     // default 100
}

// HistorySummary is one list row (no bodies, no request blobs).
type HistorySummary struct {
	ID            int64  `json:"id"`
	CreatedAt     int64  `json:"created_at"`
	ProjectID     string `json:"project_id"`
	RequestID     string `json:"request_id"`
	RequestName   string `json:"request_name"`
	Method        string `json:"method"`
	URLTemplate   string `json:"url_template"`
	URLResolved   string `json:"url_resolved"`
	EnvName       string `json:"env_name"`
	Status        int64  `json:"status"`
	DurationMs    int64  `json:"duration_ms"`
	Error         string `json:"error"`
	RespBodySize  int64  `json:"resp_body_size"`
	RespTruncated bool   `json:"resp_truncated"`
}

type HistoryPage struct {
	Items   []HistorySummary `json:"items"`
	HasMore bool             `json:"has_more"`
}

type HistoryPageResult struct {
	Data  *HistoryPage     `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// statusRange maps a status class to the SQL bounds (min 0 = any, -1 = failures).
func statusRange(class string) (int64, int64, bool) {
	switch strings.ToLower(class) {
	case "":
		return 0, 0, true
	case "err":
		return -1, -1, true
	case "2xx", "3xx", "4xx", "5xx":
		base := int64(class[0]-'0') * 100
		return base, base + 99, true
	}
	return 0, 0, false
}

const historyPageSize = 100

// ListHistory returns one page of history, newest first.
func (a *App) ListHistory(f HistoryFilter) HistoryPageResult {
	if a.store == nil {
		return HistoryPageResult{Data: &HistoryPage{Items: []HistorySummary{}}}
	}
	smin, smax, ok := statusRange(f.StatusClass)
	if !ok {
		return HistoryPageResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "unknown status class"}}
	}
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = historyPageSize
	}
	rows, err := a.store.ListHistoryPage(a.ctx, store.ListHistoryPageParams{
		ProjectID: f.ProjectID, RequestID: f.RequestID, Method: strings.ToUpper(f.Method), StatusMin: smin, StatusMax: smax,
		Needle: strings.TrimSpace(f.Query), BeforeCreated: f.BeforeCreated, BeforeID: f.BeforeID,
		PageLimit: limit + 1, // one extra: is there a next page?
	})
	if err != nil {
		return HistoryPageResult{Error: session.ProblemFrom(err)}
	}
	page := &HistoryPage{Items: make([]HistorySummary, 0, len(rows))}
	for i, r := range rows {
		if int64(i) == limit {
			page.HasMore = true
			break
		}
		page.Items = append(page.Items, HistorySummary{
			ID: r.ID, CreatedAt: r.CreatedAt, ProjectID: r.ProjectID.String, RequestID: r.RequestID.String,
			RequestName: r.RequestName.String, Method: r.Method, URLTemplate: r.UrlTemplate, URLResolved: r.UrlResolved.String,
			EnvName: r.EnvName.String, Status: r.Status, DurationMs: r.DurationMs, Error: r.Error.String,
			RespBodySize: r.RespBodySize, RespTruncated: r.RespTruncated != 0,
		})
	}
	return HistoryPageResult{Data: page}
}

// historyAuth is the effective auth of a send as authored (template form), and
// where it came from. The header / param it produced is in the resolved copy.
type historyAuth struct {
	Config api.Auth `json:"config"`
	Source string   `json:"source"`
}

// HistoryRequestForm is the request in one form (template or resolved).
type HistoryRequestForm struct {
	URL         string         `json:"url"`
	Headers     []api.KeyValue `json:"headers"`
	Params      []api.KeyValue `json:"params"` // template only (resolved params are in the URL)
	Body        string         `json:"body"`   // text as authored (template) / as sent (resolved)
	BodyType    string         `json:"body_type"`
	ContentType string         `json:"content_type"`
}

// HistoryResponse is the stored response, previewed like a live one.
type HistoryResponse struct {
	Status          int64           `json:"status"`
	StatusText      string          `json:"status_text"`
	ContentType     string          `json:"content_type"`
	Headers         []engine.Header `json:"headers"`
	Body            string          `json:"body"`     // preview, pretty when JSON
	RawBody         string          `json:"raw_body"` // set when Formatted
	Formatted       bool            `json:"formatted"`
	PreviewCut      bool            `json:"preview_cut"`      // longer than the 256 KB preview
	BodySize        int64           `json:"body_size"`        // the full size received
	StoredBytes     int64           `json:"stored_bytes"`     // what history kept
	StoredTruncated bool            `json:"stored_truncated"` // history kept less than the full body
}

// HistoryEntry is one entry in full (opened from the list).
type HistoryEntry struct {
	Summary  HistorySummary     `json:"summary"`
	EnvID    string             `json:"env_id"`
	Template HistoryRequestForm `json:"template"`
	Resolved HistoryRequestForm `json:"resolved"`
	Response *HistoryResponse   `json:"response"` // nil when the send failed
	Hops     []engine.Hop       `json:"hops"`
	// Auth is the effective auth config as authored ({{vars}}), nil when none
	// was in effect or the entry predates auth.
	Auth       *api.Auth `json:"auth"`
	AuthSource string    `json:"auth_source"`
}

type HistoryEntryResult struct {
	Data  *HistoryEntry    `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

func unmarshalOr[T any](s sql.NullString, def T) T {
	if !s.Valid {
		return def
	}
	var v T
	if err := json.Unmarshal([]byte(s.String), &v); err != nil {
		return def
	}
	return v
}

func historyNotFound() *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Message: "this history entry no longer exists"}
}

// GetHistoryEntry returns one entry with its request forms, response preview and timings.
func (a *App) GetHistoryEntry(id int64) HistoryEntryResult {
	if a.store == nil {
		return HistoryEntryResult{Error: historyNotFound()}
	}
	h, err := a.store.GetHistoryEntry(a.ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return HistoryEntryResult{Error: historyNotFound()}
		}
		return HistoryEntryResult{Error: session.ProblemFrom(err)}
	}
	body := unmarshalOr(h.ReqBodyJson, api.RequestBody{Type: api.BodyNone})
	bodyText := body.Content
	if body.Type == api.BodyForm {
		bodyText, _ = engine.SentBody(engine.Body{Type: engine.BodyForm, Fields: kvToHeaders(body.Fields)})
	}
	resolvedHeaders := unmarshalOr(h.ReqHeadersResolvedJson, []api.KeyValue{})
	e := &HistoryEntry{
		Summary: HistorySummary{
			ID: h.ID, CreatedAt: h.CreatedAt, ProjectID: h.ProjectID.String, RequestID: h.RequestID.String,
			RequestName: h.RequestName.String, Method: h.Method, URLTemplate: h.UrlTemplate, URLResolved: h.UrlResolved.String,
			EnvName: h.EnvName.String, Status: h.Status, DurationMs: h.DurationMs, Error: h.Error.String,
			RespBodySize: h.RespBodySize, RespTruncated: h.RespTruncated != 0,
		},
		EnvID: h.EnvID.String,
		Template: HistoryRequestForm{
			URL: h.UrlTemplate, Headers: unmarshalOr(h.ReqHeadersJson, []api.KeyValue{}),
			Params: unmarshalOr(h.ReqParamsJson, []api.KeyValue{}), Body: bodyText,
			BodyType: body.Type, ContentType: body.ContentType,
		},
		Resolved: HistoryRequestForm{
			URL: h.UrlResolved.String, Headers: resolvedHeaders, Params: []api.KeyValue{},
			Body: h.ReqBodyResolved.String, BodyType: body.Type, ContentType: body.ContentType,
		},
		Hops: unmarshalOr(h.TimingsJson, []engine.Hop{}),
	}
	if ha := unmarshalOr(h.ReqAuthJson, historyAuth{}); h.ReqAuthJson.Valid {
		e.Auth, e.AuthSource = &ha.Config, ha.Source
	}
	if !h.Error.Valid {
		headers := unmarshalOr(h.RespHeadersJson, []engine.Header{})
		ct := ""
		for _, hd := range headers {
			if strings.EqualFold(hd.Key, "Content-Type") {
				ct = hd.Value
			}
		}
		pv := engine.PreviewBody(h.RespBody, h.RespBodySize, ct)
		e.Response = &HistoryResponse{
			Status: h.Status, StatusText: httpStatusText(h.Status), ContentType: ct, Headers: headers,
			Body: pv.Body, RawBody: pv.RawBody, Formatted: pv.Formatted, PreviewCut: pv.Truncated,
			BodySize: h.RespBodySize, StoredBytes: int64(len(h.RespBody)), StoredTruncated: h.RespTruncated != 0,
		}
	}
	return HistoryEntryResult{Data: e}
}

func kvToHeaders(rows []api.KeyValue) []engine.Header {
	out := make([]engine.Header, 0, len(rows))
	for _, r := range rows {
		out = append(out, engine.Header{Key: r.Key, Value: r.Value, Enabled: r.Enabled})
	}
	return out
}

// DeleteHistoryEntry removes one entry.
func (a *App) DeleteHistoryEntry(id int64) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if _, err := a.store.DeleteHistoryEntry(a.ctx, id); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	if err := a.store.ReclaimSpace(a.ctx); err != nil {
		slog.Warn("reclaim history space", "err", err)
	}
	return EmptyResult{}
}

// HistoryStorageInfo is the Settings modal's storage line.
type HistoryStorageInfo struct {
	RowCount   int64 `json:"row_count"`
	TotalBytes int64 `json:"total_bytes"` // the local database on disk (history is nearly all of it)
}

type HistoryStorageResult struct {
	Data  *HistoryStorageInfo `json:"data"`
	Error *session.Problem    `json:"error,omitempty"`
}

// GetHistoryStorageInfo returns the entry count and the database size.
func (a *App) GetHistoryStorageInfo() HistoryStorageResult {
	if a.store == nil {
		return HistoryStorageResult{Data: &HistoryStorageInfo{}}
	}
	info, err := a.store.HistoryStorage(a.ctx)
	if err != nil {
		return HistoryStorageResult{Error: session.ProblemFrom(err)}
	}
	return HistoryStorageResult{Data: &HistoryStorageInfo{RowCount: info.Rows, TotalBytes: info.Bytes}}
}

type DeletedResult struct {
	Data  int64            `json:"data"` // rows deleted
	Error *session.Problem `json:"error,omitempty"`
}

// ClearHistory deletes entries: "all", "older_than_30d" or "current_project"
// (projectID), then frees the space on disk.
func (a *App) ClearHistory(scope, projectID string) DeletedResult {
	if a.store == nil {
		return DeletedResult{Error: problemNotLoggedIn}
	}
	n, err := a.store.ClearHistory(a.ctx, store.HistoryScope(scope), projectID, time.Now())
	if err != nil {
		return DeletedResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	return DeletedResult{Data: n}
}

// HistorySettings are the retention settings (0 = unlimited).
type HistorySettings struct {
	MaxEntries       int64 `json:"max_entries"`
	MaxResponseBytes int64 `json:"max_response_bytes"`
}

// GetHistorySettings returns the retention settings.
func (a *App) GetHistorySettings() HistorySettings {
	if a.store == nil {
		return HistorySettings{MaxEntries: store.DefaultHistoryMaxEntries, MaxResponseBytes: store.DefaultHistoryMaxResponseBytes}
	}
	l := a.store.HistoryLimits(a.ctx)
	return HistorySettings{MaxEntries: l.MaxEntries, MaxResponseBytes: l.MaxResponseBytes}
}

// SetHistoryMaxEntries stores the entry limit and prunes to it now (the UI asks
// first when that deletes entries); returns the number deleted.
func (a *App) SetHistoryMaxEntries(n int64) DeletedResult {
	if a.store == nil {
		return DeletedResult{Error: problemNotLoggedIn}
	}
	deleted, err := a.store.SetHistoryMaxEntries(a.ctx, n)
	if err != nil {
		return DeletedResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	return DeletedResult{Data: deleted}
}

// SetHistoryMaxResponseBytes stores the per-entry body cap (new entries).
func (a *App) SetHistoryMaxResponseBytes(n int64) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.SetHistoryMaxResponseBytes(a.ctx, n); err != nil {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	return EmptyResult{}
}

// RestoreHistoryEntry creates a new request at the project root from the entry's
// TEMPLATE form (method, url, headers, params, body as authored) and returns it.
func (a *App) RestoreHistoryEntry(id int64, projectID string) RequestSummaryResult {
	if a.store == nil {
		return RequestSummaryResult{Error: problemNotLoggedIn}
	}
	h, err := a.store.GetHistoryEntry(a.ctx, id)
	if err != nil {
		return RequestSummaryResult{Error: historyNotFound()}
	}
	draft := api.RequestDraft{
		Method:      h.Method,
		URL:         h.UrlTemplate,
		Headers:     unmarshalOr(h.ReqHeadersJson, []api.KeyValue{}),
		QueryParams: unmarshalOr(h.ReqParamsJson, []api.KeyValue{}),
		Body:        unmarshalOr(h.ReqBodyJson, api.RequestBody{Type: api.BodyNone}),
		Auth:        restoredAuth(h.ReqAuthJson),
	}
	name := restoredName(h.RequestName.String, h.Method, h.UrlTemplate)
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.RequestSummary, error) {
		return c.CreateRequestFrom(ctx, projectID, nil, name, draft)
	})
	return RequestSummaryResult{Data: ptr(v, p), Error: p}
}

// restoredAuth: the new request sits at the project root, so the auth that was
// in effect (possibly inherited from a folder) is set on it explicitly; "no
// auth" becomes inherit, which at the root is the same.
func restoredAuth(raw sql.NullString) api.Auth {
	ha := unmarshalOr(raw, historyAuth{})
	switch api.NormalizeAuth(ha.Config).Type {
	case api.AuthBearer, api.AuthBasic, api.AuthAPIKey:
		return api.NormalizeAuth(ha.Config)
	}
	return api.NormalizeAuth(api.Auth{Type: api.AuthInherit})
}

// restoredName: "<name> (from history)", or "<METHOD> <host/path>" for entries
// without a name (older rows).
func restoredName(requestName, method, rawURL string) string {
	base := strings.TrimSpace(requestName)
	if base == "" {
		base = method
		if u, err := url.Parse(rawURL); err == nil && (u.Host != "" || u.Path != "") {
			base += " " + u.Host + u.Path
		} else if rawURL != "" {
			base += " " + rawURL
		}
	}
	name := base + " (from history)"
	if len(name) > 200 {
		name = name[:200]
	}
	return name
}

func httpStatusText(status int64) string {
	if status == 0 {
		return ""
	}
	return http.StatusText(int(status))
}
