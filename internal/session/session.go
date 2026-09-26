// Package session owns the client's connection to the Ghostman server: which
// server URL is in effect, the persisted session token, and the auth state the
// UI renders (loading / logged_in / logged_out / unreachable).
package session

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"ghostman/internal/api"
	"ghostman/internal/store"
)

// logoutTimeout bounds the best-effort server logout so a dead server never
// makes the Logout button hang.
const logoutTimeout = 3 * time.Second

// State is the coarse auth state that picks which screen the UI shows.
type State string

const (
	StateLoading     State = "loading"
	StateLoggedIn    State = "logged_in"
	StateLoggedOut   State = "logged_out"
	StateUnreachable State = "unreachable"
)

// AuthState is what the UI renders from.
type AuthState struct {
	State     State     `json:"state"`
	User      *api.User `json:"user,omitempty"`
	ServerURL string    `json:"serverUrl"`
	// Message is a short human reason for an unreachable state ("connection refused").
	Message string `json:"message,omitempty"`
}

// Result is returned by operations that can fail in an expected way. State is
// always the current auth state after the operation; Error is set on failure.
type Result struct {
	State AuthState `json:"state"`
	Error *Problem  `json:"error,omitempty"`
}

// Client is the subset of *api.APIClient the manager needs.
type Client interface {
	Register(ctx context.Context, email, password, name string) (api.AuthResponse, error)
	Login(ctx context.Context, email, password string) (api.AuthResponse, error)
	Logout(ctx context.Context) error
	Me(ctx context.Context) (api.User, error)
	Health(ctx context.Context) error
	SetToken(token string)
}

// ClientFactory builds a client for a (normalized) server URL.
type ClientFactory func(baseURL string) Client

// Settings is the local key/value store (implemented by *store.Store).
type Settings interface {
	Setting(ctx context.Context, key string) (string, bool, error)
	PutSetting(ctx context.Context, key, value string) error
	DeleteSetting(ctx context.Context, key string) error
}

// Manager serializes all auth operations; each holds the lock for its duration,
// so e.g. a login cannot interleave with a server URL change.
type Manager struct {
	settings   Settings
	newClient  ClientFactory
	defaultURL string

	mu     sync.Mutex
	client Client
	token  string
	state  AuthState
}

// NewManager validates defaultURL (the compiled-in default server) and returns a
// manager in the loading state. Call Check to resolve the real state.
func NewManager(settings Settings, newClient ClientFactory, defaultURL string) (*Manager, error) {
	normalized, err := api.NormalizeServerURL(defaultURL)
	if err != nil {
		return nil, fmt.Errorf("invalid default server URL %q: %w", defaultURL, err)
	}
	return &Manager{
		settings:   settings,
		newClient:  newClient,
		defaultURL: normalized,
		state:      AuthState{State: StateLoading, ServerURL: normalized},
	}, nil
}

// State returns the current auth state without contacting the server.
func (m *Manager) State() AuthState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// IsLoggedIn reports whether a user session is active.
func (m *Manager) IsLoggedIn() bool {
	return m.State().State == StateLoggedIn
}

// Check is the startup flow: resolve the server URL, load the token, and ask the
// server who we are (or, without a token, whether it is up).
func (m *Manager) Check(ctx context.Context) AuthState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.checkLocked(ctx)
}

func (m *Manager) checkLocked(ctx context.Context) AuthState {
	serverURL := m.resolveServerURLLocked(ctx)
	m.client = m.newClient(serverURL)

	token, ok, err := m.settings.Setting(ctx, store.SettingSessionToken)
	if err != nil {
		slog.Error("load session token", "err", err)
	}
	if !ok {
		token = ""
	}
	m.token = token
	m.client.SetToken(token)

	if token == "" {
		if err := m.client.Health(ctx); err != nil {
			return m.setUnreachableLocked(serverURL, err)
		}
		return m.setLocked(AuthState{State: StateLoggedOut, ServerURL: serverURL})
	}

	user, err := m.client.Me(ctx)
	switch {
	case err == nil:
		return m.setLocked(AuthState{State: StateLoggedIn, User: &user, ServerURL: serverURL})
	case api.IsUnauthorized(err):
		slog.Info("stored session is no longer valid; logging out")
		m.clearTokenLocked(ctx)
		return m.setLocked(AuthState{State: StateLoggedOut, ServerURL: serverURL})
	default:
		// Keep the token: the server may just be down, and the session may still be valid.
		return m.setUnreachableLocked(serverURL, err)
	}
}

// Login authenticates and persists the session token.
func (m *Manager) Login(ctx context.Context, email, password string) Result {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureClientLocked(ctx)
	res, err := m.client.Login(ctx, email, password)
	return m.finishAuthLocked(ctx, res, err)
}

// Register creates an account, logs in, and persists the session token.
func (m *Manager) Register(ctx context.Context, email, password, name string) Result {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureClientLocked(ctx)
	res, err := m.client.Register(ctx, email, password, name)
	return m.finishAuthLocked(ctx, res, err)
}

func (m *Manager) finishAuthLocked(ctx context.Context, res api.AuthResponse, err error) Result {
	if err != nil {
		problem := ProblemFrom(err)
		if problem.Kind == KindUnreachable {
			m.setUnreachableLocked(m.state.ServerURL, err)
		}
		return Result{State: m.state, Error: problem}
	}

	m.token = res.Token
	m.client.SetToken(res.Token)
	if err := m.settings.PutSetting(ctx, store.SettingSessionToken, res.Token); err != nil {
		// Still logged in for this run; the user just has to log in again next launch.
		slog.Error("persist session token", "err", err)
	}
	user := res.User
	m.setLocked(AuthState{State: StateLoggedIn, User: &user, ServerURL: m.state.ServerURL})
	return Result{State: m.state}
}

// Logout always clears the local session. Telling the server is best-effort.
func (m *Manager) Logout(ctx context.Context) AuthState {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil && m.token != "" {
		ctx, cancel := context.WithTimeout(ctx, logoutTimeout)
		if err := m.client.Logout(ctx); err != nil {
			slog.Info("server logout failed (ignored)", "err", err)
		}
		cancel()
	}
	m.clearTokenLocked(ctx)
	return m.setLocked(AuthState{State: StateLoggedOut, ServerURL: m.state.ServerURL})
}

// ServerURL returns the server URL in effect (the override if set, else the default).
func (m *Manager) ServerURL(ctx context.Context) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.resolveServerURLLocked(ctx)
}

// SetServerURL validates and persists a new server URL, then re-runs Check.
// Switching to a different server drops the session (its token belongs to the
// old server). Saving the same URL just re-checks, which makes it a "Retry".
func (m *Manager) SetServerURL(ctx context.Context, raw string) Result {
	m.mu.Lock()
	defer m.mu.Unlock()

	normalized, err := api.NormalizeServerURL(raw)
	if err != nil {
		return Result{State: m.state, Error: &Problem{Kind: KindInvalid, Message: err.Error()}}
	}

	current := m.resolveServerURLLocked(ctx)
	if normalized != current {
		// An override equal to the default is removed, so the app keeps following
		// the compiled-in default if a later release changes it.
		if normalized == m.defaultURL {
			err = m.settings.DeleteSetting(ctx, store.SettingServerURL)
		} else {
			err = m.settings.PutSetting(ctx, store.SettingServerURL, normalized)
		}
		if err != nil {
			slog.Error("persist server URL", "err", err)
			return Result{State: m.state, Error: internalProblem()}
		}
		if m.token != "" || m.state.State == StateLoggedIn {
			slog.Info("server URL changed; dropping session", "from", current, "to", normalized)
			m.clearTokenLocked(ctx)
		}
	}
	return Result{State: m.checkLocked(ctx)}
}

// ensureClientLocked makes sure a client exists (Check normally creates it).
func (m *Manager) ensureClientLocked(ctx context.Context) {
	if m.client == nil {
		m.client = m.newClient(m.resolveServerURLLocked(ctx))
		m.client.SetToken(m.token)
	}
}

func (m *Manager) resolveServerURLLocked(ctx context.Context) string {
	override, ok, err := m.settings.Setting(ctx, store.SettingServerURL)
	if err != nil {
		slog.Error("load server URL setting", "err", err)
		return m.defaultURL
	}
	if !ok {
		return m.defaultURL
	}
	normalized, err := api.NormalizeServerURL(override)
	if err != nil {
		slog.Warn("ignoring invalid stored server URL", "value", override, "err", err)
		return m.defaultURL
	}
	return normalized
}

func (m *Manager) clearTokenLocked(ctx context.Context) {
	m.token = ""
	if m.client != nil {
		m.client.SetToken("")
	}
	if err := m.settings.DeleteSetting(ctx, store.SettingSessionToken); err != nil {
		slog.Error("delete session token", "err", err)
	}
}

func (m *Manager) setUnreachableLocked(serverURL string, err error) AuthState {
	msg := ProblemFrom(err).Message
	var unreachable *api.ServerUnreachableError
	var apiErr *api.APIError
	switch {
	case errors.As(err, &unreachable):
		msg = unreachable.Reason()
	case errors.As(err, &apiErr):
		// The server answered, but not usefully (e.g. 503 "database is not reachable").
		msg = fmt.Sprintf("the server is not working: %s", apiErr.Message)
	}
	slog.Info("server unreachable", "url", serverURL, "err", err)
	return m.setLocked(AuthState{State: StateUnreachable, ServerURL: serverURL, Message: msg})
}

func (m *Manager) setLocked(s AuthState) AuthState {
	m.state = s
	return s
}
