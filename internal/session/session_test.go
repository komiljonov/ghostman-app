package session

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"syscall"
	"testing"

	"ghostman/internal/api"
	"ghostman/internal/store"
)

const defaultURL = "http://localhost:8080"

// fakeServer describes how the "server" at one URL behaves.
type fakeServer struct {
	down       bool   // every call is unreachable
	unhealthy  bool   // /healthz answers 503
	validToken string // token Me accepts
	logouts    int
}

// fakeClient implements Client against a fakeServer.
type fakeClient struct {
	url   string
	srv   *fakeServer
	token string
}

func (c *fakeClient) unreachable() error {
	return &api.ServerUnreachableError{URL: c.url, Err: syscall.ECONNREFUSED}
}

func (c *fakeClient) SetToken(t string) { c.token = t }

func (c *fakeClient) Health(context.Context) error {
	if c.srv.down {
		return c.unreachable()
	}
	if c.srv.unhealthy {
		return &api.APIError{Status: 503, Code: "service_unavailable", Message: "database is not reachable"}
	}
	return nil
}

func (c *fakeClient) Me(context.Context) (api.User, error) {
	if c.srv.down {
		return api.User{}, c.unreachable()
	}
	if c.token == "" || c.token != c.srv.validToken {
		return api.User{}, &api.APIError{Status: 401, Code: "unauthorized", Message: "invalid or expired token"}
	}
	return api.User{ID: "u-1", Email: "ada@example.com", Name: "Ada"}, nil
}

func (c *fakeClient) Login(_ context.Context, email, password string) (api.AuthResponse, error) {
	if c.srv.down {
		return api.AuthResponse{}, c.unreachable()
	}
	if password != "correct-horse" {
		return api.AuthResponse{}, &api.APIError{Status: 401, Code: "unauthorized", Message: "invalid email or password"}
	}
	c.srv.validToken = "tok-" + email
	return api.AuthResponse{User: api.User{ID: "u-1", Email: email, Name: "Ada"}, Token: c.srv.validToken}, nil
}

func (c *fakeClient) Register(_ context.Context, email, _, name string) (api.AuthResponse, error) {
	if c.srv.down {
		return api.AuthResponse{}, c.unreachable()
	}
	if email == "taken@example.com" {
		return api.AuthResponse{}, &api.APIError{Status: http.StatusConflict, Code: "conflict", Message: "an account with that email already exists"}
	}
	c.srv.validToken = "tok-" + email
	return api.AuthResponse{User: api.User{ID: "u-2", Email: email, Name: name}, Token: c.srv.validToken}, nil
}

func (c *fakeClient) Logout(context.Context) error {
	if c.srv.down {
		return c.unreachable()
	}
	c.srv.logouts++
	c.srv.validToken = ""
	return nil
}

type harness struct {
	t       *testing.T
	ctx     context.Context
	store   *store.Store
	servers map[string]*fakeServer
	m       *Manager
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	h := &harness{t: t, ctx: context.Background(), store: st, servers: map[string]*fakeServer{defaultURL: {}}}
	h.m = h.newManager()
	return h
}

// newManager simulates an app (re)start over the same database.
func (h *harness) newManager() *Manager {
	h.t.Helper()
	m, err := NewManager(h.store, func(url string) Client {
		srv, ok := h.servers[url]
		if !ok {
			srv = &fakeServer{down: true} // nothing listens at unknown URLs
		}
		return &fakeClient{url: url, srv: srv}
	}, defaultURL)
	if err != nil {
		h.t.Fatal(err)
	}
	return m
}

func (h *harness) setting(key string) (string, bool) {
	h.t.Helper()
	v, ok, err := h.store.Setting(h.ctx, key)
	if err != nil {
		h.t.Fatal(err)
	}
	return v, ok
}

func TestStartupStateMatrix(t *testing.T) {
	tests := []struct {
		name        string
		storedToken string
		server      fakeServer
		want        State
		wantToken   bool // token still stored afterwards
	}{
		{name: "no token, server up", server: fakeServer{}, want: StateLoggedOut},
		{name: "no token, server down", server: fakeServer{down: true}, want: StateUnreachable},
		{name: "no token, server db down", server: fakeServer{unhealthy: true}, want: StateUnreachable},
		{name: "valid token", storedToken: "good", server: fakeServer{validToken: "good"}, want: StateLoggedIn, wantToken: true},
		{name: "expired token (401)", storedToken: "stale", server: fakeServer{validToken: "good"}, want: StateLoggedOut},
		{name: "token, server down", storedToken: "good", server: fakeServer{down: true, validToken: "good"}, want: StateUnreachable, wantToken: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t)
			srv := tt.server
			h.servers[defaultURL] = &srv
			if tt.storedToken != "" {
				if err := h.store.PutSetting(h.ctx, store.SettingSessionToken, tt.storedToken); err != nil {
					t.Fatal(err)
				}
			}

			if s := h.m.State(); s.State != StateLoading {
				t.Fatalf("initial state = %q, want loading", s.State)
			}
			got := h.m.Check(h.ctx)
			if got.State != tt.want || got.ServerURL != defaultURL {
				t.Fatalf("state = %+v, want %q", got, tt.want)
			}
			if (got.User != nil) != (tt.want == StateLoggedIn) {
				t.Errorf("user = %+v", got.User)
			}
			if tt.want == StateUnreachable && got.Message == "" {
				t.Error("unreachable state needs a message")
			}
			if _, ok := h.setting(store.SettingSessionToken); ok != tt.wantToken {
				t.Errorf("token stored = %v, want %v", ok, tt.wantToken)
			}
		})
	}
}

func TestLoginPersistsTokenAcrossRestart(t *testing.T) {
	h := newHarness(t)
	h.m.Check(h.ctx)

	res := h.m.Login(h.ctx, "ada@example.com", "wrong")
	if res.Error == nil || res.Error.Kind != KindServer || res.Error.Status != 401 ||
		res.Error.Message != "invalid email or password" || res.State.State != StateLoggedOut {
		t.Fatalf("bad-credentials result = %+v / %+v", res.State, res.Error)
	}

	res = h.m.Login(h.ctx, "ada@example.com", "correct-horse")
	if res.Error != nil || res.State.State != StateLoggedIn || res.State.User.Email != "ada@example.com" {
		t.Fatalf("login result = %+v / %+v", res.State, res.Error)
	}
	if tok, _ := h.setting(store.SettingSessionToken); tok != "tok-ada@example.com" {
		t.Fatalf("stored token = %q", tok)
	}

	// Restart: a fresh manager revalidates the stored token via Me.
	restarted := h.newManager().Check(h.ctx)
	if restarted.State != StateLoggedIn || restarted.User == nil || restarted.User.Name != "Ada" {
		t.Fatalf("after restart = %+v", restarted)
	}
}

func TestRegister(t *testing.T) {
	h := newHarness(t)
	h.m.Check(h.ctx)

	res := h.m.Register(h.ctx, "taken@example.com", "correct-horse", "X")
	if res.Error == nil || res.Error.Status != http.StatusConflict || res.Error.Message != "an account with that email already exists" {
		t.Fatalf("conflict result = %+v", res.Error)
	}
	res = h.m.Register(h.ctx, "grace@example.com", "correct-horse", "Grace")
	if res.Error != nil || res.State.State != StateLoggedIn || res.State.User.Name != "Grace" {
		t.Fatalf("register result = %+v / %+v", res.State, res.Error)
	}
}

func TestLoginWhileServerDownSwitchesToUnreachable(t *testing.T) {
	h := newHarness(t)
	h.m.Check(h.ctx)
	h.servers[defaultURL].down = true

	res := h.m.Login(h.ctx, "ada@example.com", "correct-horse")
	if res.Error == nil || res.Error.Kind != KindUnreachable || res.State.State != StateUnreachable {
		t.Fatalf("result = %+v / %+v", res.State, res.Error)
	}
}

func TestLogoutAlwaysClearsToken(t *testing.T) {
	for _, down := range []bool{false, true} {
		h := newHarness(t)
		h.m.Check(h.ctx)
		h.m.Login(h.ctx, "ada@example.com", "correct-horse")
		h.servers[defaultURL].down = down

		got := h.m.Logout(h.ctx)
		if got.State != StateLoggedOut {
			t.Errorf("down=%v: state = %q", down, got.State)
		}
		if _, ok := h.setting(store.SettingSessionToken); ok {
			t.Errorf("down=%v: token still stored", down)
		}
		if wantLogouts := map[bool]int{false: 1, true: 0}[down]; h.servers[defaultURL].logouts != wantLogouts {
			t.Errorf("down=%v: server logouts = %d", down, h.servers[defaultURL].logouts)
		}
	}
}

func TestSetServerURL(t *testing.T) {
	h := newHarness(t)
	h.m.Check(h.ctx)
	h.m.Login(h.ctx, "ada@example.com", "correct-horse")

	// Invalid input: clear error, nothing saved, still logged in.
	res := h.m.SetServerURL(h.ctx, "localhost:9999")
	if res.Error == nil || res.Error.Kind != KindInvalid || res.State.State != StateLoggedIn {
		t.Fatalf("invalid URL result = %+v / %+v", res.State, res.Error)
	}
	if _, ok := h.setting(store.SettingServerURL); ok {
		t.Fatal("invalid URL was persisted")
	}

	// Re-saving the current URL is a plain re-check: session kept.
	res = h.m.SetServerURL(h.ctx, "http://localhost:8080/")
	if res.Error != nil || res.State.State != StateLoggedIn {
		t.Fatalf("same URL result = %+v / %+v", res.State, res.Error)
	}

	// A different (dead) server: normalized + persisted, session dropped, unreachable.
	res = h.m.SetServerURL(h.ctx, "  http://localhost:9999/ ")
	if res.Error != nil || res.State.State != StateUnreachable || res.State.ServerURL != "http://localhost:9999" {
		t.Fatalf("new URL result = %+v / %+v", res.State, res.Error)
	}
	if v, _ := h.setting(store.SettingServerURL); v != "http://localhost:9999" {
		t.Fatalf("stored server_url = %q", v)
	}
	if _, ok := h.setting(store.SettingSessionToken); ok {
		t.Fatal("token kept after switching servers")
	}
	if got := h.newManager().ServerURL(h.ctx); got != "http://localhost:9999" {
		t.Fatalf("override not used after restart: %q", got)
	}

	// Back to the default: override removed, logged out (token was dropped).
	res = h.m.SetServerURL(h.ctx, defaultURL)
	if res.State.State != StateLoggedOut || res.State.ServerURL != defaultURL {
		t.Fatalf("back to default = %+v", res.State)
	}
	if _, ok := h.setting(store.SettingServerURL); ok {
		t.Fatal("override equal to the default should be removed")
	}
}

func TestNewManagerRejectsBadDefault(t *testing.T) {
	if _, err := NewManager(nil, nil, "not-a-url"); err == nil {
		t.Fatal("expected error")
	}
}

func TestProblemFromUnknownErrorHidesDetails(t *testing.T) {
	p := ProblemFrom(errors.New(`pq: {"raw":"json"}`))
	if p.Kind != KindInternal || p.Message == "" || p.Message == `pq: {"raw":"json"}` {
		t.Fatalf("problem = %+v", p)
	}
}
