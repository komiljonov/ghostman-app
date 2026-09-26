// Package api is the typed client for the Ghostman server's REST API (/api/v1).
// Every method returns typed structs; failures are *APIError (the server answered
// with an error envelope) or *ServerUnreachableError (no usable answer at all).
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// DefaultTimeout bounds every call to the server.
const DefaultTimeout = 10 * time.Second

// maxResponseBody caps how much of a server response is read. Auth responses are tiny.
const maxResponseBody = 1 << 20

// User is the server's user shape.
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

// AuthResponse is returned by Register and Login.
type AuthResponse struct {
	User  User   `json:"user"`
	Token string `json:"token"`
}

// APIClient talks to one server. It is safe for concurrent use.
type APIClient struct {
	baseURL string
	http    *http.Client

	mu    sync.RWMutex
	token string
}

// New returns a client for baseURL (already normalized, see NormalizeServerURL).
func New(baseURL string) *APIClient {
	return &APIClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: DefaultTimeout},
	}
}

// BaseURL returns the server this client talks to.
func (c *APIClient) BaseURL() string { return c.baseURL }

// SetToken sets the bearer token sent with every request ("" to send none).
func (c *APIClient) SetToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = token
}

// Token returns the current bearer token.
func (c *APIClient) Token() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token
}

// Register creates an account and returns it with a new session token.
func (c *APIClient) Register(ctx context.Context, email, password, name string) (AuthResponse, error) {
	var out AuthResponse
	body := map[string]string{"email": email, "password": password, "name": name}
	err := c.do(ctx, http.MethodPost, "/api/v1/auth/register", body, &out)
	return out, err
}

// Login exchanges credentials for a session token.
func (c *APIClient) Login(ctx context.Context, email, password string) (AuthResponse, error) {
	var out AuthResponse
	body := map[string]string{"email": email, "password": password}
	err := c.do(ctx, http.MethodPost, "/api/v1/auth/login", body, &out)
	return out, err
}

// Logout ends the current session on the server.
func (c *APIClient) Logout(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/api/v1/auth/logout", nil, nil)
}

// Me returns the user the current token belongs to.
func (c *APIClient) Me(ctx context.Context) (User, error) {
	var out User
	err := c.do(ctx, http.MethodGet, "/api/v1/me", nil, &out)
	return out, err
}

// Health checks that the server (and its database) is up.
func (c *APIClient) Health(ctx context.Context) error {
	return c.do(ctx, http.MethodGet, "/healthz", nil, nil)
}

// do sends a JSON request and decodes a JSON response into out (nil to discard).
func (c *APIClient) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		buf, err := json.Marshal(in)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		body = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token := c.Token(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return &ServerUnreachableError{URL: c.baseURL, Err: unwrapURLError(err)}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBody))
	if err != nil {
		return &ServerUnreachableError{URL: c.baseURL, Err: err}
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return parseErrorResponse(resp.StatusCode, raw)
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &APIError{
			Status:  resp.StatusCode,
			Code:    CodeBadResponse,
			Message: "the server sent a response Ghostman could not understand",
		}
	}
	return nil
}

func unwrapURLError(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		return uerr.Err
	}
	return err
}
