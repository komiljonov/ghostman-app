package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"os"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/filter"
	"ghostman/internal/session"
)

// The response filter bar: a jq query (gojq, internal/filter) over the FULL body
// Go holds — the tab's active response, or a history entry's stored body. The
// body is parsed once and cached (per tab until the next send replaces the held
// body; one history entry at a time), so each keystroke only runs the query.
// Only the result's 256 KB display copy crosses the bridge; copy and save use
// the whole result, Go-side. Queries are literal: {{vars}} are not resolved.

type clipboardFunc func(ctx context.Context, text string) error

// parsedDoc is a body parsed for the filter, computed on first use.
type parsedDoc struct {
	once sync.Once
	doc  *filter.Doc
	err  error
}

func (p *parsedDoc) get(body []byte) (*filter.Doc, error) {
	p.once.Do(func() { p.doc, p.err = filter.Parse(body) })
	return p.doc, p.err
}

// historyDocCache keeps the last history entry's parsed body (the detail pane
// filters one entry at a time).
type historyDocCache struct {
	mu   sync.Mutex
	id   int64
	doc  *parsedDoc
	name string
	body []byte
	err  error // the entry is gone / failed
}

// FilterResult is one evaluation for the UI. Error is a human message (a jq
// syntax error while typing is normal; the UI shows it quietly).
type FilterResult struct {
	ResultJSON   string `json:"result_json"`    // the display copy, capped at 256 KB
	ResultIsText bool   `json:"result_is_text"` // a single string result, shown as text
	Count        int    `json:"count"`
	Truncated    bool   `json:"truncated"`
	MatchedNote  string `json:"matched_note"` // "12 results · 8.1 KB of 40.2 MB" / "no matches"
	Error        string `json:"error"`
}

func toFilterResult(r filter.Result, err error) FilterResult {
	if err != nil {
		return FilterResult{Error: err.Error()}
	}
	return FilterResult{ResultJSON: r.Text, ResultIsText: r.IsText, Count: r.Count, Truncated: r.Truncated, MatchedNote: r.Note}
}

var errNoResponse = errors.New("send the request first")

// tabFilter runs query over a tab's active response.
func (a *App) tabFilter(tabID, query string) (filter.Result, error) {
	b, ok := a.responses.get(tabID)
	if !ok {
		return filter.Result{}, errNoResponse
	}
	if b.parsed == nil {
		return filter.Result{}, errNoResponse
	}
	doc, err := b.parsed.get(b.data)
	if err != nil {
		return filter.Result{}, err
	}
	return filter.Eval(a.ctx, doc, query)
}

// historyDocFor returns a history entry's parsed body and request name. The
// last entry is cached (the detail pane filters one entry at a time), so typing
// neither re-reads the row from SQLite nor re-parses the body.
func (a *App) historyDocFor(id int64) (*filter.Doc, string, error) {
	a.historyDoc.mu.Lock()
	if a.historyDoc.doc == nil || a.historyDoc.id != id {
		a.historyDoc.id, a.historyDoc.doc, a.historyDoc.name, a.historyDoc.err, a.historyDoc.body = id, &parsedDoc{}, "", nil, nil
		gone := errors.New("this history entry no longer exists")
		if a.store == nil {
			a.historyDoc.err = gone
		} else if h, err := a.store.GetHistoryEntry(a.ctx, id); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				slog.Warn("history filter", "id", id, "err", err)
			}
			a.historyDoc.err = gone
		} else if h.Error.Valid {
			a.historyDoc.err = errors.New("this request failed — there is no response")
		} else {
			a.historyDoc.name, a.historyDoc.body = h.RequestName.String, h.RespBody
		}
	}
	p, name, body, err := a.historyDoc.doc, a.historyDoc.name, a.historyDoc.body, a.historyDoc.err
	a.historyDoc.mu.Unlock()
	if err != nil {
		return nil, "", err
	}
	doc, err := p.get(body)
	return doc, name, err
}

// forgetHistoryDoc drops the cached entry (it was deleted or cleared).
func (a *App) forgetHistoryDoc() {
	a.historyDoc.mu.Lock()
	a.historyDoc.doc, a.historyDoc.body = nil, nil
	a.historyDoc.mu.Unlock()
}

// historyFilter runs query over a history entry's stored body; it also returns
// the entry's request name (for file names).
func (a *App) historyFilter(id int64, query string) (filter.Result, string, error) {
	doc, name, err := a.historyDocFor(id)
	if err != nil {
		return filter.Result{}, "", err
	}
	r, err := filter.Eval(a.ctx, doc, query)
	return r, name, err
}

// EvalResponseFilter runs a jq query over the tab's active response body.
func (a *App) EvalResponseFilter(tabID, query string) FilterResult {
	if strings.TrimSpace(query) == "" {
		return FilterResult{}
	}
	return toFilterResult(a.tabFilter(tabID, query))
}

// EvalHistoryFilter runs a jq query over a history entry's stored body.
func (a *App) EvalHistoryFilter(id int64, query string) FilterResult {
	if strings.TrimSpace(query) == "" {
		return FilterResult{}
	}
	r, _, err := a.historyFilter(id, query)
	return toFilterResult(r, err)
}

func (a *App) copyResult(r filter.Result, err error) EmptyResult {
	if err != nil {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	if err := a.clipboard(a.ctx, string(r.Full)); err != nil {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not copy: " + err.Error()}}
	}
	return EmptyResult{}
}

// CopyFilteredResult copies the whole filtered result (not just the 256 KB
// preview) to the clipboard, Go-side.
func (a *App) CopyFilteredResult(tabID, query string) EmptyResult {
	return a.copyResult(a.tabFilter(tabID, query))
}

// CopyHistoryFilteredResult is CopyFilteredResult for a history entry.
func (a *App) CopyHistoryFilteredResult(id int64, query string) EmptyResult {
	r, _, err := a.historyFilter(id, query)
	return a.copyResult(r, err)
}

func (a *App) saveResult(r filter.Result, err error, requestName string) SavedFileResult {
	if err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInvalid, Message: err.Error()}}
	}
	ct := "application/json"
	if r.IsText {
		ct = "text/plain"
	}
	name := strings.TrimSpace(requestName)
	if name == "" {
		name = "response"
	}
	path, derr := a.saveDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save filtered result",
		DefaultFilename: responseFileName(name+" filtered", ct),
	})
	if derr != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not open the save dialog: " + derr.Error()}}
	}
	if path == "" {
		return SavedFileResult{}
	}
	if werr := os.WriteFile(path, r.Full, 0o644); werr != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not write the file: " + werr.Error()}}
	}
	return SavedFileResult{Data: &SavedFile{Path: path, BytesWritten: int64(len(r.Full))}}
}

// SaveFilteredResponseToFile saves the whole filtered result of the tab's
// active response (the JSON the result view shows, uncapped).
func (a *App) SaveFilteredResponseToFile(tabID, query string) SavedFileResult {
	r, err := a.tabFilter(tabID, query)
	return a.saveResult(r, err, a.requestNameForFile(tabID))
}

// SaveHistoryFilteredToFile is SaveFilteredResponseToFile for a history entry.
func (a *App) SaveHistoryFilteredToFile(id int64, query string) SavedFileResult {
	r, name, err := a.historyFilter(id, query)
	return a.saveResult(r, err, name)
}

// WarmResponseFilter starts parsing the tab's active response in the background
// (the filter input got focus), so the first keystroke does not wait for a big
// body to parse. Lazy on purpose: tabs that never filter never hold the parsed
// document. Returns at once.
func (a *App) WarmResponseFilter(tabID string) {
	b, ok := a.responses.get(tabID)
	if !ok || b.parsed == nil {
		return
	}
	go func() { _, _ = b.parsed.get(b.data) }()
}

// WarmHistoryFilter is WarmResponseFilter for a history entry's stored body.
func (a *App) WarmHistoryFilter(id int64) {
	go func() { _, _, _ = a.historyDocFor(id) }()
}
