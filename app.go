package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/engine"
	"ghostman/internal/store"
)

const historyLimit = 50

// App is bound to the frontend. Its exported methods are the whole Go<->TS API;
// keep them thin and put logic in internal/.
type App struct {
	ctx    context.Context
	engine *engine.Engine
	store  *store.Store
}

// NewApp creates the bound App. The database is opened in startup, not here,
// because Wails also runs main() at build time to generate bindings.
func NewApp(eng *engine.Engine) *App {
	return &App{ctx: context.Background(), engine: eng}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	path, err := databasePath()
	if err == nil {
		a.store, err = store.Open(ctx, path)
	}
	if err != nil {
		slog.Error("open database", "path", path, "err", err)
		_, _ = runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   "Ghostman cannot start",
			Message: fmt.Sprintf("Could not open the local database:\n%s\n\n%v", path, err),
		})
		runtime.Quit(ctx)
		return
	}
	slog.Info("database ready", "path", path)
}

func (a *App) shutdown(context.Context) {
	if a.store == nil {
		return
	}
	if err := a.store.Close(); err != nil {
		slog.Error("close database", "err", err)
	}
}

// Send executes a request and records it in history. Transport failures reject
// the JS promise with a human-readable message.
func (a *App) Send(spec engine.RequestSpec) (*engine.Response, error) {
	start := time.Now()
	resp, err := a.engine.SendRequest(a.ctx, spec)

	entry := store.InsertHistoryParams{
		Method:    strings.ToUpper(strings.TrimSpace(spec.Method)),
		Url:       strings.TrimSpace(spec.URL),
		CreatedAt: start.UnixMilli(),
	}
	if err != nil {
		entry.DurationMs = time.Since(start).Milliseconds()
		slog.Info("request failed", "method", entry.Method, "url", entry.Url, "err", err)
	} else {
		entry.Status = int64(resp.Status)
		entry.DurationMs = resp.DurationMs
		slog.Info("request sent", "method", entry.Method, "url", entry.Url, "status", resp.Status, "duration_ms", resp.DurationMs)
	}
	if entry.Url != "" && a.store != nil {
		// History is best-effort: a DB problem must not hide the response.
		if herr := a.store.InsertHistory(a.ctx, entry); herr != nil {
			slog.Error("record history", "err", herr)
		}
	}
	return resp, err
}

// History returns the most recent requests, newest first.
func (a *App) History() ([]store.History, error) {
	if a.store == nil {
		return nil, errors.New("history is unavailable: database not open")
	}
	rows, err := a.store.ListHistory(a.ctx, historyLimit)
	if err != nil {
		slog.Error("list history", "err", err)
		return nil, errors.New("could not load history")
	}
	if rows == nil {
		rows = []store.History{}
	}
	return rows, nil
}

// databasePath returns the per-user DB location: %AppData%\Ghostman on Windows,
// $XDG_CONFIG_HOME/Ghostman (usually ~/.config/Ghostman) on Linux.
// GHOSTMAN_DB overrides it (useful for development and tests).
func databasePath() (string, error) {
	if p := os.Getenv("GHOSTMAN_DB"); p != "" {
		return p, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("locate user config dir: %w", err)
	}
	return filepath.Join(dir, "Ghostman", "ghostman.db"), nil
}
