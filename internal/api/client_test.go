package api

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeServer mimics the Ghostman server's auth endpoints.
func fakeServer(t *testing.T) *httptest.Server {
	t.Helper()
	const token = "tok-123"
	user := User{ID: "u-1", Email: "a@example.com", Name: "Ada"}
	writeErr := func(w http.ResponseWriter, status int, code, msg string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
	}
	authed := func(r *http.Request) bool { return r.Header.Get("Authorization") == "Bearer "+token }

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/register", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["email"] == "taken@example.com" {
			writeErr(w, http.StatusConflict, "conflict", "an account with that email already exists")
			return
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(AuthResponse{User: User{ID: "u-2", Email: in["email"], Name: in["name"]}, Token: token})
	})
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["password"] != "correct-horse" {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid email or password")
			return
		}
		_ = json.NewEncoder(w).Encode(AuthResponse{User: user, Token: token})
	})
	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if !authed(r) {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		if !authed(r) {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
			return
		}
		_ = json.NewEncoder(w).Encode(user)
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("GET /html", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("<html>bad gateway</html>"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestClient_LoginMeLogout(t *testing.T) {
	ctx := context.Background()
	c := New(fakeServer(t).URL)

	res, err := c.Login(ctx, "a@example.com", "correct-horse")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if res.Token != "tok-123" || res.User.Name != "Ada" || res.User.ID != "u-1" {
		t.Fatalf("login response = %+v", res)
	}

	// Without a token, Me is rejected: proves the header is only sent when set.
	if _, err := c.Me(ctx); !IsUnauthorized(err) {
		t.Fatalf("Me without token: err = %v, want 401", err)
	}

	c.SetToken(res.Token)
	me, err := c.Me(ctx)
	if err != nil || me.Email != "a@example.com" {
		t.Fatalf("Me with token: %+v, %v", me, err)
	}
	if err := c.Logout(ctx); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if err := c.Health(ctx); err != nil {
		t.Fatalf("health: %v", err)
	}
}

func TestClient_Register(t *testing.T) {
	c := New(fakeServer(t).URL)
	res, err := c.Register(context.Background(), "new@example.com", "correct-horse", "Grace")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if res.User.Email != "new@example.com" || res.User.Name != "Grace" || res.Token == "" {
		t.Fatalf("register response = %+v", res)
	}
}

func TestClient_ErrorEnvelopes(t *testing.T) {
	ctx := context.Background()
	c := New(fakeServer(t).URL)

	tests := []struct {
		name       string
		call       func() error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{
			name:       "bad credentials",
			call:       func() error { _, err := c.Login(ctx, "a@example.com", "wrong"); return err },
			wantStatus: 401, wantCode: "unauthorized", wantMsg: "invalid email or password",
		},
		{
			name:       "email taken",
			call:       func() error { _, err := c.Register(ctx, "taken@example.com", "correct-horse", "X"); return err },
			wantStatus: 409, wantCode: "conflict", wantMsg: "an account with that email already exists",
		},
		{
			name:       "non-envelope body",
			call:       func() error { return c.do(ctx, http.MethodGet, "/html", nil, nil) },
			wantStatus: 502, wantCode: CodeBadResponse, wantMsg: "unexpected response (HTTP 502)",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.call()
			var apiErr *APIError
			if !errors.As(err, &apiErr) {
				t.Fatalf("err = %T %v, want *APIError", err, err)
			}
			if apiErr.Status != tt.wantStatus || apiErr.Code != tt.wantCode || !strings.Contains(apiErr.Message, tt.wantMsg) {
				t.Errorf("got %+v", apiErr)
			}
			if errors.Is(err, ErrServerUnreachable) {
				t.Error("an API error must not look unreachable")
			}
		})
	}
}

func TestClient_BearerInjection(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := New(srv.URL)
	_ = c.Health(context.Background())
	c.SetToken("abc")
	_ = c.Health(context.Background())
	c.SetToken("")
	_ = c.Health(context.Background())

	want := []string{"", "Bearer abc", ""}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("Authorization headers = %q, want %q", got, want)
	}
}

func TestClient_Unreachable(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closedURL := "http://" + ln.Addr().String()
	_ = ln.Close()

	c := New(closedURL)
	_, err = c.Me(context.Background())
	var unreachable *ServerUnreachableError
	if !errors.As(err, &unreachable) || !errors.Is(err, ErrServerUnreachable) {
		t.Fatalf("err = %T %v, want *ServerUnreachableError", err, err)
	}
	if msg := err.Error(); msg != "cannot reach the server at "+closedURL+": connection refused" {
		t.Errorf("message = %q", msg)
	}
	if IsUnauthorized(err) {
		t.Error("unreachable must not look unauthorized")
	}
}

func TestClient_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer srv.Close()

	c := New(srv.URL)
	c.http.Timeout = 100 * time.Millisecond
	err := c.Health(context.Background())
	if !errors.Is(err, ErrServerUnreachable) || !strings.Contains(err.Error(), "did not respond in time") {
		t.Fatalf("err = %v", err)
	}
}

func TestNormalizeServerURL(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr string
	}{
		{in: "http://localhost:8080", want: "http://localhost:8080"},
		{in: "  https://api.example.com/  ", want: "https://api.example.com"},
		{in: "HTTPS://API.Example.com:443/", want: "https://api.example.com:443"},
		{in: "http://example.com/ghostman///", want: "http://example.com/ghostman"},
		{in: "http://127.0.0.1:9999", want: "http://127.0.0.1:9999"},
		{in: "", wantErr: "required"},
		{in: "   ", wantErr: "required"},
		{in: "localhost:8080", wantErr: "must start with http:// or https://"},
		{in: "ftp://example.com", wantErr: "must start with http:// or https://"},
		{in: "http://", wantErr: "must include a host"},
		{in: "http://:8080", wantErr: "must include a host"},
		{in: "http://localhost:", wantErr: "empty port"},
		{in: "http://localhost:abc", wantErr: "not a valid URL"},
		{in: "http://user:pw@example.com", wantErr: "username or password"},
		{in: "http://example.com?x=1", wantErr: "query string"},
		{in: "http://exa mple.com", wantErr: "not a valid URL"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := NormalizeServerURL(tt.in)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("NormalizeServerURL(%q) = %q, %v; want error containing %q", tt.in, got, err, tt.wantErr)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("NormalizeServerURL(%q) = %q, %v; want %q", tt.in, got, err, tt.want)
			}
		})
	}
}
