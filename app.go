package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/session"
	"ghostman/internal/store"
	"ghostman/internal/workspace"
)

const historyLimit = 50

var errNotLoggedIn = errors.New("log in to send requests")

// App is bound to the frontend. Its exported methods are the whole Go<->TS API;
// keep them thin and put logic in internal/.
type App struct {
	ctx        context.Context
	engine     *engine.Engine
	serverURL  string // compiled-in default server
	store      *store.Store
	session    *session.Manager
	authReady  chan struct{} // closed once the startup auth check has finished
	startupErr error

	workspace *workspace.Manager

	clientMu sync.Mutex
	client   *api.APIClient // the session's current server client (token included)
}

// Settings is what the settings modal edits.
type Settings struct {
	ServerURL string `json:"serverUrl"`
}

// NewApp creates the bound App. The database is opened in startup, not here,
// because Wails also runs main() at build time to generate bindings.
func NewApp(eng *engine.Engine, defaultServerURL string) *App {
	return &App{
		ctx:       context.Background(),
		engine:    eng,
		serverURL: defaultServerURL,
		authReady: make(chan struct{}),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.init(ctx); err != nil {
		a.startupErr = err
		close(a.authReady)
		slog.Error("startup failed", "err", err)
		_, _ = runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   "Ghostman cannot start",
			Message: err.Error(),
		})
		runtime.Quit(ctx)
		return
	}

	// Check the session in the background so the window appears immediately;
	// GetAuthState waits for it.
	go func() {
		defer close(a.authReady)
		st := a.session.Check(ctx)
		slog.Info("auth state", "state", st.State, "server", st.ServerURL)
	}()
}

func (a *App) init(ctx context.Context) error {
	path, err := databasePath()
	if err != nil {
		return err
	}
	a.store, err = store.Open(ctx, path)
	if err != nil {
		return fmt.Errorf("could not open the local database:\n%s\n\n%w", path, err)
	}
	slog.Info("database ready", "path", path)
	a.workspace = workspace.New(a.store)

	a.session, err = session.NewManager(a.store, func(baseURL string) session.Client {
		c := api.New(baseURL)
		a.clientMu.Lock()
		a.client = c
		a.clientMu.Unlock()
		return c
	}, a.serverURL)
	return err
}

func (a *App) shutdown(context.Context) {
	if a.store == nil {
		return
	}
	if err := a.store.Close(); err != nil {
		slog.Error("close database", "err", err)
	}
}

// GetAuthState returns the auth state, waiting for the startup check if it is still running.
func (a *App) GetAuthState() session.AuthState {
	select {
	case <-a.authReady:
	case <-a.ctx.Done():
	}
	if a.session == nil {
		return session.AuthState{State: session.StateLoading, ServerURL: a.serverURL}
	}
	return a.session.State()
}

// Login authenticates against the server. Failures come back in Result.Error.
func (a *App) Login(email, password string) session.Result {
	return a.session.Login(a.ctx, strings.TrimSpace(email), password)
}

// Register creates an account and logs in. Failures come back in Result.Error.
func (a *App) Register(email, password, name string) session.Result {
	return a.session.Register(a.ctx, strings.TrimSpace(email), password, strings.TrimSpace(name))
}

// Logout clears the local session (always) and tells the server (best-effort).
func (a *App) Logout() session.AuthState {
	return a.session.Logout(a.ctx)
}

// GetSettings returns the user-editable settings.
func (a *App) GetSettings() Settings {
	return Settings{ServerURL: a.session.ServerURL(a.ctx)}
}

// SetServerURL validates and saves the server URL, then re-checks the connection.
// Saving the current URL again acts as "retry".
func (a *App) SetServerURL(url string) session.Result {
	return a.session.SetServerURL(a.ctx, url)
}

// Send executes a request and records it in history. Transport failures reject
// the JS promise with a human-readable message.
func (a *App) Send(spec engine.RequestSpec) (*engine.Response, error) {
	if !a.session.IsLoggedIn() {
		return nil, errNotLoggedIn
	}

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
	if entry.Url != "" {
		// History is best-effort: a DB problem must not hide the response.
		if herr := a.store.InsertHistory(a.ctx, entry); herr != nil {
			slog.Error("record history", "err", herr)
		}
	}
	return resp, err
}

// History returns the most recent requests, newest first.
func (a *App) History() ([]store.History, error) {
	if !a.session.IsLoggedIn() {
		return nil, errNotLoggedIn
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
