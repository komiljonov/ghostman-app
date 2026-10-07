package main

import (
	"bytes"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/engine"
	"ghostman/internal/session"
)

// Media responses in history. Every body is stored as bytes whatever its type
// (resp_body BLOB, up to history_max_response_bytes); a media / binary body is
// never sent to the UI as text. Images, audio and video are served to the
// webview by an app-local route, so <img>/<audio>/<video> stream them straight
// from SQLite and multi-MB bodies never cross the Wails bridge; anything can be
// saved to a file.

const historyMediaPrefix = "/history-media/"

func historyMediaURL(id int64) string { return historyMediaPrefix + strconv.FormatInt(id, 10) }

// servableMedia: the kinds the route serves (displayable in the webview).
func servableMedia(kind string) bool {
	return kind == engine.MediaImage || kind == engine.MediaAudio || kind == engine.MediaVideo
}

// historyMediaMiddleware serves GET /history-media/{id} (assetserver.Options
// Middleware, so it works in dev and built apps alike); every other request goes
// on to the frontend assets. Only image / audio / video bodies are served —
// never HTML or other text — with their stored type, nosniff, no caching (ids can
// be reused after a clear) and a sandboxing CSP in case one is opened directly.
// Range requests work (http.ServeContent), so video and audio can seek.
func (a *App) historyMediaMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, historyMediaPrefix) {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, historyMediaPrefix), 10, 64)
		if err != nil || a.store == nil {
			http.NotFound(w, r)
			return
		}
		h, err := a.store.GetHistoryEntry(r.Context(), id)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				slog.Warn("serve history media", "id", id, "err", err)
			}
			http.NotFound(w, r)
			return
		}
		ct := historyContentType(h.RespHeadersJson)
		if h.Error.Valid || !servableMedia(engine.MediaKind(ct, h.RespBody)) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", engine.MimeType(ct))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
		http.ServeContent(w, r, "", time.UnixMilli(h.CreatedAt), bytes.NewReader(h.RespBody))
	})
}

// historyContentType is the stored response's Content-Type header ("" if none).
func historyContentType(headersJSON sql.NullString) string {
	for _, hd := range unmarshalOr(headersJSON, []engine.Header{}) {
		if strings.EqualFold(hd.Key, "Content-Type") {
			return hd.Value
		}
	}
	return ""
}

// SaveHistoryResponseToFile saves a history entry's stored response body (any
// type) through the native save dialog; the default name is the request name +
// an extension for its Content-Type. TruncatedAtCap reports that history kept
// only the first part of the body (history_max_response_bytes). Cancelling
// returns neither data nor error. The bytes never cross the bridge.
func (a *App) SaveHistoryResponseToFile(id int64) SavedFileResult {
	if a.store == nil {
		return SavedFileResult{Error: historyNotFound()}
	}
	h, err := a.store.GetHistoryEntry(a.ctx, id)
	if err != nil {
		return SavedFileResult{Error: historyNotFound()}
	}
	if h.Error.Valid {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "this request failed — there is no response to save"}}
	}
	name := strings.TrimSpace(h.RequestName.String)
	if name == "" {
		name = "response"
	}
	path, err := a.saveDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save response",
		DefaultFilename: responseFileName(name, historyContentType(h.RespHeadersJson)),
	})
	if err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not open the save dialog: " + err.Error()}}
	}
	if path == "" {
		return SavedFileResult{}
	}
	if err := os.WriteFile(path, h.RespBody, 0o644); err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not write the file: " + err.Error()}}
	}
	slog.Info("history response saved", "id", id, "bytes", len(h.RespBody))
	return SavedFileResult{Data: &SavedFile{Path: path, BytesWritten: int64(len(h.RespBody)), TruncatedAtCap: h.RespTruncated != 0}}
}
