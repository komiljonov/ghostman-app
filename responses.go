package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/session"
)

// Full response bodies, Go-side only. The UI only ever gets the 256 KB preview;
// the complete body (up to engine.MaxFullBody) of each request tab's ACTIVE
// response is held here for "Save response to file": replaced by the next send,
// dropped when the tab closes (ReleaseResponse, or SetTabs no longer listing it),
// when the tab controller goes away (project switch) and on logout.

type heldBody struct {
	projectID   string
	data        []byte
	capped      bool // the body was larger than engine.MaxFullBody
	contentType string
	version     int64      // bumped by every put: the media URL changes with each response
	parsed      *parsedDoc // the body parsed as JSON for the filter bar, once (lazily)
}

type responseStore struct {
	mu     sync.Mutex
	bodies map[string]heldBody // request (tab) id -> active response body
	next   int64
}

func newResponseStore() *responseStore { return &responseStore{bodies: map[string]heldBody{}} }

// put stores a tab's active body and returns its version (for the media URL).
func (s *responseStore) put(id string, b heldBody) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next++
	b.version = s.next
	b.parsed = &parsedDoc{} // a new response: the filter parses it again (once)
	s.bodies[id] = b
	return b.version
}

func (s *responseStore) get(id string) (heldBody, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.bodies[id]
	return b, ok
}

func (s *responseStore) release(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.bodies, id)
}

// keepOnly drops the project's bodies whose tab is not in open.
func (s *responseStore) keepOnly(projectID string, open map[string]bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, b := range s.bodies {
		if b.projectID == projectID && !open[id] {
			delete(s.bodies, id)
		}
	}
}

func (s *responseStore) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bodies = map[string]heldBody{}
}

// size reports how many bodies are held (tests).
func (s *responseStore) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.bodies)
}

// ReleaseResponse frees the full body kept for a request tab (the tab closed).
func (a *App) ReleaseResponse(tabID string) {
	a.responses.release(tabID)
}

// saveDialog is the native "Save as" dialog; tests replace it. "" = cancelled.
type saveDialog func(ctx context.Context, opts runtime.SaveDialogOptions) (string, error)

// SavedFile is what SaveResponseToFile reports.
type SavedFile struct {
	Path           string `json:"path"`
	BytesWritten   int64  `json:"bytes_written"`
	TruncatedAtCap bool   `json:"truncated_at_cap"` // the body was over 20 MB: its first 20 MB were saved
}

type SavedFileResult struct {
	Data  *SavedFile       `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// SaveResponseToFile asks where to save (native dialog, default name from the
// request name + an extension for the content type) and writes the tab's full
// response body there. The bytes never cross the bridge. Cancelling the dialog
// returns neither data nor error.
func (a *App) SaveResponseToFile(tabID string) SavedFileResult {
	body, ok := a.responses.get(tabID)
	if !ok {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInvalid, Message: "no response to save — send the request first"}}
	}
	name := a.requestNameForFile(tabID)
	path, err := a.saveDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save response",
		DefaultFilename: responseFileName(name, body.contentType),
	})
	if err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not open the save dialog: " + err.Error()}}
	}
	if path == "" {
		return SavedFileResult{} // cancelled
	}
	if err := os.WriteFile(path, body.data, 0o644); err != nil {
		return SavedFileResult{Error: &session.Problem{Kind: session.KindInternal, Message: "could not write the file: " + err.Error()}}
	}
	slog.Info("response saved", "bytes", len(body.data), "capped", body.capped)
	return SavedFileResult{Data: &SavedFile{Path: path, BytesWritten: int64(len(body.data)), TruncatedAtCap: body.capped}}
}

// requestNameForFile is the request's current name (from the server), or
// "response" when it cannot be read.
func (a *App) requestNameForFile(id string) string {
	type nameOnly struct{ name string }
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (nameOnly, error) {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		r, err := c.GetRequest(ctx, id)
		return nameOnly{r.Name}, err
	})
	if p != nil || strings.TrimSpace(v.name) == "" {
		return "response"
	}
	return v.name
}

// responseFileName builds a safe default file name: the request name with
// characters Windows/Linux reject replaced, plus an extension for the type.
func responseFileName(requestName, contentType string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(requestName) {
		if r < 0x20 || strings.ContainsRune(`<>:"/\|?*`, r) {
			b.WriteRune('_')
		} else {
			b.WriteRune(r)
		}
	}
	base := strings.Trim(b.String(), " .")
	if base == "" {
		base = "response"
	}
	return fmt.Sprintf("%s.%s", base, extensionFor(contentType))
}

// mediaExtensions: images, audio, video and documents by their media type.
var mediaExtensions = map[string]string{
	"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp",
	"image/bmp": "bmp", "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
	"image/avif": "avif", "image/tiff": "tiff",
	"audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav",
	"audio/x-wav": "wav", "audio/webm": "weba", "audio/flac": "flac",
	"video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv", "video/quicktime": "mov",
	"application/pdf": "pdf", "application/zip": "zip", "application/gzip": "gz",
}

// extensionFor maps a response Content-Type to a file extension.
func extensionFor(contentType string) string {
	ct := engine.MimeType(contentType)
	if ext, ok := mediaExtensions[ct]; ok {
		return ext
	}
	switch {
	case strings.Contains(ct, "json"):
		return "json"
	case ct == "text/html" || ct == "application/xhtml+xml":
		return "html"
	case strings.Contains(ct, "xml"):
		return "xml"
	case strings.HasPrefix(ct, "text/"):
		return "txt"
	default:
		return "bin"
	}
}
