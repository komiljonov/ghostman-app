package api

import (
	"context"
	"net/http"
	"net/url"
	"slices"
)

// Proxies are per-project objects (like environments). A proxy's PASSWORD is
// not here and never sent: it lives only on this machine (local proxy_passwords,
// proxies.go in the app) — the server knows the username at most.

// Proxy types.
const (
	ProxyTypeHTTP   = "http"
	ProxyTypeHTTPS  = "https"
	ProxyTypeSOCKS5 = "socks5"
)

// ProxyTypes lists the types in display order.
var ProxyTypes = []string{ProxyTypeHTTP, ProxyTypeHTTPS, ProxyTypeSOCKS5}

// The cascading proxy setting of a request or folder (NodeProxy.Mode).
const (
	ProxyModeInherit = "inherit" // the parent's setting, up to the global default
	ProxyModeGlobal  = "global"  // the global default (per project, local), skipping ancestors
	ProxyModeNone    = "none"    // direct; stops the chain
	ProxyModeProxy   = "proxy"   // ProxyID (nil once that proxy is deleted: resolved as inherit)
)

// ProxyModes lists the modes in display order.
var ProxyModes = []string{ProxyModeInherit, ProxyModeGlobal, ProxyModeNone, ProxyModeProxy}

// ValidProxyMode reports whether m is a known mode.
func ValidProxyMode(m string) bool { return slices.Contains(ProxyModes, m) }

// NodeProxy is a node's stored proxy setting, unresolved.
type NodeProxy struct {
	Mode    string  `json:"mode"`
	ProxyID *string `json:"proxy_id"`
}

// NormalizeNodeProxy fills a missing mode (an older server) with inherit and
// drops an id that does not go with the mode.
func NormalizeNodeProxy(p NodeProxy) NodeProxy {
	if !ValidProxyMode(p.Mode) {
		p.Mode = ProxyModeInherit
	}
	if p.Mode != ProxyModeProxy {
		p.ProxyID = nil
	}
	return p
}

// Proxy is one proxy of a project.
type Proxy struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	ProxyType string `json:"proxy_type"`
	Host      string `json:"host"`
	Port      int32  `json:"port"`
	Username  string `json:"username"`
	Bypass    string `json:"bypass"` // comma-separated host patterns
	SortOrder int32  `json:"sort_order"`
	CreatedAt string `json:"created_at"`
}

// NewProxy is the input of CreateProxy.
type NewProxy struct {
	Name      string `json:"name"`
	ProxyType string `json:"proxy_type"`
	Host      string `json:"host"`
	Port      int32  `json:"port"`
	Username  string `json:"username"`
	Bypass    string `json:"bypass"`
}

// ProxyPatch is a partial update; nil fields are left unchanged.
type ProxyPatch struct {
	Name      *string `json:"name,omitempty"`
	ProxyType *string `json:"proxy_type,omitempty"`
	Host      *string `json:"host,omitempty"`
	Port      *int32  `json:"port,omitempty"`
	Username  *string `json:"username,omitempty"`
	Bypass    *string `json:"bypass,omitempty"`
}

func proxyPath(id string) string { return "/api/v1/proxies/" + url.PathEscape(id) }

// CreateProxy creates a proxy in a project.
func (c *APIClient) CreateProxy(ctx context.Context, projectID string, in NewProxy) (Proxy, error) {
	var out Proxy
	err := c.do(ctx, http.MethodPost, projectPath(projectID)+"/proxies", in, &out)
	return out, err
}

// ListProxies returns a project's proxies in order.
func (c *APIClient) ListProxies(ctx context.Context, projectID string) ([]Proxy, error) {
	out := []Proxy{}
	err := c.do(ctx, http.MethodGet, projectPath(projectID)+"/proxies", nil, &out)
	return out, err
}

// GetProxy returns one proxy.
func (c *APIClient) GetProxy(ctx context.Context, id string) (Proxy, error) {
	var out Proxy
	err := c.do(ctx, http.MethodGet, proxyPath(id), nil, &out)
	return out, err
}

// UpdateProxy applies a partial update.
func (c *APIClient) UpdateProxy(ctx context.Context, id string, patch ProxyPatch) (Proxy, error) {
	var out Proxy
	err := c.do(ctx, http.MethodPatch, proxyPath(id), patch, &out)
	return out, err
}

// DeleteProxy deletes a proxy; nodes pointing at it keep mode "proxy" with a
// null id (resolved as inherit).
func (c *APIClient) DeleteProxy(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, proxyPath(id), nil, nil)
}

// ReorderProxies sets a project's proxy order (every proxy, once).
func (c *APIClient) ReorderProxies(ctx context.Context, projectID string, ids []string) error {
	body := map[string]any{"project_id": projectID, "proxy_ids": nonNil(ids)}
	return c.do(ctx, http.MethodPut, "/api/v1/proxies/order", body, nil)
}

// SetRequestProxy sets a request's cascading proxy setting.
func (c *APIClient) SetRequestProxy(ctx context.Context, id string, p NodeProxy) (Request, error) {
	var out Request
	err := c.do(ctx, http.MethodPatch, requestPath(id), map[string]any{"proxy": nodeProxyWire(p)}, &out)
	return out, err
}

// nodeProxyWire is the PATCH shape: proxy_id only with mode "proxy".
func nodeProxyWire(p NodeProxy) map[string]any {
	if p.Mode == ProxyModeProxy {
		return map[string]any{"mode": p.Mode, "proxy_id": p.ProxyID}
	}
	return map[string]any{"mode": p.Mode}
}
