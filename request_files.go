package main

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/engine"
	"ghostman/internal/session"
)

// Multipart file fields: WHICH file a field sends is local to this machine (the
// secrets pattern). The synced body names the file by its display name only; the
// path lives in request_files (request id + field key) and the bytes are read
// from disk at send time (internal/engine/multipart.go). Neither ever reaches
// the server, and paths are never logged.

// RequestFile is a file field's local state.
type RequestFile struct {
	Key      string `json:"key"`
	Path     string `json:"path"`      // full path on this machine (shown as a tooltip only)
	FileName string `json:"file_name"` // its base name (the synced display name)
	Size     int64  `json:"size"`
	Exists   bool   `json:"exists"` // false: chosen once, but gone from disk now
}

type RequestFileResult struct {
	Data  *RequestFile     `json:"data"` // nil when the dialog was cancelled
	Error *session.Problem `json:"error,omitempty"`
}

type RequestFileListResult struct {
	Data  []RequestFile    `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

func fileProblem(msg string) *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Message: msg}
}

func describeFile(key, path string) RequestFile {
	f := RequestFile{Key: key, Path: path, FileName: filepath.Base(path)}
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		f.Size, f.Exists = info.Size(), true
	}
	return f
}

// ChooseRequestFile opens the native file dialog for a file field and stores the
// chosen path locally. The UI then sets the field's file_name (the autosave
// PATCHes it). Cancel → no data, no error.
func (a *App) ChooseRequestFile(requestID, fieldKey string) RequestFileResult {
	key := strings.TrimSpace(fieldKey)
	if a.store == nil {
		return RequestFileResult{Error: problemNotLoggedIn}
	}
	if requestID == "" || key == "" {
		return RequestFileResult{Error: fileProblem("give the field a key first")}
	}
	path, err := a.openDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose a file for '" + key + "'"})
	if err != nil {
		return RequestFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not open the file dialog: " + err.Error()}}
	}
	if path == "" {
		return RequestFileResult{}
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return RequestFileResult{Error: fileProblem("that is not a readable file")}
	}
	if err := a.store.PutRequestFilePath(a.ctx, requestID, key, path); err != nil {
		return RequestFileResult{Error: session.ProblemFrom(err)}
	}
	f := describeFile(key, path)
	return RequestFileResult{Data: &f}
}

// ClearRequestFile forgets a field's local path (the UI clears its file_name).
func (a *App) ClearRequestFile(requestID, fieldKey string) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.DeleteRequestFilePath(a.ctx, requestID, strings.TrimSpace(fieldKey)); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}

// RenameRequestFileKey moves a field's path along when its key is edited
// (unless the new key already has one).
func (a *App) RenameRequestFileKey(requestID, oldKey, newKey string) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	from, to := strings.TrimSpace(oldKey), strings.TrimSpace(newKey)
	if from == to || from == "" {
		return EmptyResult{}
	}
	if to == "" {
		return a.ClearRequestFile(requestID, from)
	}
	// Never overwrite another field's file: the path then stays where it is.
	m, err := a.store.RequestFileMap(a.ctx, requestID)
	if err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	if _, taken := m[to]; taken {
		return EmptyResult{}
	}
	if err := a.store.RenameRequestFilePath(a.ctx, requestID, from, to); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}

// ListRequestFiles returns a request's local file fields (with whether each
// file is still on disk).
func (a *App) ListRequestFiles(requestID string) RequestFileListResult {
	out := []RequestFile{}
	if a.store == nil {
		return RequestFileListResult{Data: out}
	}
	m, err := a.store.RequestFileMap(a.ctx, requestID)
	if err != nil {
		return RequestFileListResult{Data: out, Error: session.ProblemFrom(err)}
	}
	for key, path := range m {
		out = append(out, describeFile(key, path))
	}
	return RequestFileListResult{Data: out}
}

// attachFiles fills a multipart spec's file parts with their local paths (by
// request + key). A field without one keeps Path "" and the engine names it.
func (a *App) attachFiles(requestID string, spec *engine.RequestSpec) {
	if a.store == nil || spec.Body.Type != engine.BodyMultipart {
		return
	}
	m, err := a.store.RequestFileMap(a.ctx, requestID)
	if err != nil {
		slog.Warn("load request file paths", "request", requestID, "err", err)
		return
	}
	for i, p := range spec.Body.Parts {
		if p.Kind == engine.PartFile {
			spec.Body.Parts[i].Path = m[strings.TrimSpace(p.Key)]
		}
	}
}

// copyRequestFiles gives a duplicated request the original's local file paths.
func (a *App) copyRequestFiles(fromID, toID string) {
	if a.store == nil {
		return
	}
	m, err := a.store.RequestFileMap(a.ctx, fromID)
	if err != nil {
		slog.Warn("copy request file paths", "request", fromID, "err", err)
		return
	}
	for key, path := range m {
		if err := a.store.PutRequestFilePath(a.ctx, toID, key, path); err != nil {
			slog.Warn("copy request file paths", "request", toID, "err", err)
			return
		}
	}
}
