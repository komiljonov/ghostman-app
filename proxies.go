package main

import (
	"context"
	"log/slog"
	"slices"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/engine"
	"ghostman/internal/envs"
	"ghostman/internal/session"
)

// Bound proxy methods: thin {data, error} wrappers over the API client, plus
// the local-only pieces — a proxy's PASSWORD (proxy_passwords, never sent to the
// server, never logged) and each project's global default proxy (settings
// proxy_global_<project_id>). Which proxy a send uses is resolved in the UI
// (settingsResolver.resolveProxy); Go loads that proxy fresh and adds its local
// password at send time (sendProxy).

type ProxyResult struct {
	Data  *api.Proxy       `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type ProxyListResult struct {
	Data  []api.Proxy      `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// ProxyPassword is a proxy's local password, for the proxy tab (local data,
// like a revealed secret value).
type ProxyPassword struct {
	Set      bool   `json:"set"`
	Password string `json:"password"`
}

type ProxyPasswordResult struct {
	Data  *ProxyPassword   `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// ProxyInput is the proxy tab's form (all fields; the PATCH holds the changed ones).
type ProxyInput struct {
	Name      string `json:"name"`
	ProxyType string `json:"proxy_type"`
	Host      string `json:"host"`
	Port      int32  `json:"port"`
	Username  string `json:"username"`
	Bypass    string `json:"bypass"`
}

const settingProxyGlobalPrefix = "proxy_global_"

// ProxyGlobalNone is the global default "No proxy".
const ProxyGlobalNone = "none"

func invalidProxy(msg string) *session.Problem {
	return &session.Problem{Kind: session.KindInvalid, Message: msg}
}

func validProxyInput(in ProxyInput) *session.Problem {
	switch {
	case strings.TrimSpace(in.Name) == "":
		return invalidProxy("give the proxy a name")
	case !slices.Contains(api.ProxyTypes, in.ProxyType):
		return invalidProxy("proxy type must be http, https or socks5")
	case strings.TrimSpace(in.Host) == "":
		return invalidProxy("enter the proxy's host")
	case in.Port < 1 || in.Port > 65535:
		return invalidProxy("port must be between 1 and 65535")
	}
	return nil
}

// ListProxies returns the project's proxies in order.
func (a *App) ListProxies(projectID string) ProxyListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.Proxy, error) { return c.ListProxies(ctx, projectID) })
	return ProxyListResult{Data: v, Error: p}
}

// GetProxy returns one proxy.
func (a *App) GetProxy(id string) ProxyResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Proxy, error) { return c.GetProxy(ctx, id) })
	return ProxyResult{Data: ptr(v, p), Error: p}
}

// CreateProxy creates a proxy (the list tab's "+": an http proxy on localhost
// to edit, or the given fields).
func (a *App) CreateProxy(projectID string, in ProxyInput) ProxyResult {
	if p := validProxyInput(in); p != nil {
		return ProxyResult{Error: p}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Proxy, error) {
		return c.CreateProxy(ctx, projectID, api.NewProxy{
			Name: strings.TrimSpace(in.Name), ProxyType: in.ProxyType, Host: strings.TrimSpace(in.Host), Port: in.Port,
			Username: in.Username, Bypass: in.Bypass,
		})
	})
	return ProxyResult{Data: ptr(v, p), Error: p}
}

// UpdateProxy saves the fields that differ between saved and next.
func (a *App) UpdateProxy(id string, saved, next ProxyInput) ProxyResult {
	if p := validProxyInput(next); p != nil {
		return ProxyResult{Error: p}
	}
	var patch api.ProxyPatch
	changed := false
	set := func(dst **string, from, to string) {
		if from != to {
			v := to
			*dst, changed = &v, true
		}
	}
	set(&patch.Name, saved.Name, strings.TrimSpace(next.Name))
	set(&patch.ProxyType, saved.ProxyType, next.ProxyType)
	set(&patch.Host, saved.Host, strings.TrimSpace(next.Host))
	set(&patch.Username, saved.Username, next.Username)
	set(&patch.Bypass, saved.Bypass, next.Bypass)
	if saved.Port != next.Port {
		port := next.Port
		patch.Port, changed = &port, true
	}
	if !changed {
		return a.GetProxy(id)
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Proxy, error) { return c.UpdateProxy(ctx, id, patch) })
	return ProxyResult{Data: ptr(v, p), Error: p}
}

// DeleteProxy deletes a proxy on the server and its password on this machine
// (requests using it fall back to inherit; a global default naming it reads as none).
func (a *App) DeleteProxy(id string) EmptyResult {
	res := callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.DeleteProxy(ctx, id) })
	if res.Error == nil && a.store != nil {
		if err := a.store.SetProxyPassword(a.ctx, id, ""); err != nil {
			slog.Warn("delete local proxy password", "proxy", id, "err", err)
		}
	}
	return res
}

// ReorderProxies sets the project's proxy order.
func (a *App) ReorderProxies(projectID string, ids []string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.ReorderProxies(ctx, projectID, ids) })
}

// GetProxyPassword returns the proxy's password stored on this machine.
func (a *App) GetProxyPassword(id string) ProxyPasswordResult {
	if a.store == nil {
		return ProxyPasswordResult{Error: problemNotLoggedIn}
	}
	pw, ok, err := a.store.ProxyPassword(a.ctx, id)
	if err != nil {
		return ProxyPasswordResult{Error: session.ProblemFrom(err)}
	}
	return ProxyPasswordResult{Data: &ProxyPassword{Set: ok, Password: pw}}
}

// SetProxyPassword stores the proxy's password on this machine only ("" removes it).
func (a *App) SetProxyPassword(id, password string) EmptyResult {
	if a.store == nil {
		return EmptyResult{Error: problemNotLoggedIn}
	}
	if err := a.store.SetProxyPassword(a.ctx, id, password); err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}

// GetProxyGlobal returns the project's global default proxy: "none" or a proxy id
// (the UI treats an id no longer in the list as none).
func (a *App) GetProxyGlobal(projectID string) string {
	if a.store == nil || projectID == "" {
		return ProxyGlobalNone
	}
	if v, ok := a.setting(settingProxyGlobalPrefix + projectID); ok && v != "" {
		return v
	}
	return ProxyGlobalNone
}

// SetProxyGlobal sets the project's global default proxy ("none" or a proxy id).
func (a *App) SetProxyGlobal(projectID, value string) EmptyResult {
	if projectID == "" || strings.TrimSpace(value) == "" {
		return EmptyResult{Error: invalidProxy("choose No proxy or a proxy")}
	}
	return a.putSetting(settingProxyGlobalPrefix+projectID, value)
}

// SetRequestProxy sets a request's cascading proxy setting (Settings tab).
func (a *App) SetRequestProxy(id, mode, proxyID string) RequestResult {
	np, p := nodeProxyFrom(mode, proxyID)
	if p != nil {
		return RequestResult{Error: p}
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) {
		return c.SetRequestProxy(ctx, id, np)
	})
	return RequestResult{Data: ptr(v, p), Error: p}
}

func nodeProxyFrom(mode, proxyID string) (api.NodeProxy, *session.Problem) {
	if !api.ValidProxyMode(mode) {
		return api.NodeProxy{}, invalidProxy("proxy mode must be inherit, global, none or proxy")
	}
	if mode == api.ProxyModeProxy {
		if proxyID == "" {
			return api.NodeProxy{}, invalidProxy("choose a proxy")
		}
		return api.NodeProxy{Mode: mode, ProxyID: &proxyID}, nil
	}
	return api.NodeProxy{Mode: mode}, nil
}

// sendProxy loads the proxy a send resolved to (fresh from the server) and
// adds its local password. The warning is set when the proxy has a username but
// this machine holds no password for it: the send then goes without credentials.
func (a *App) sendProxy(ctx context.Context, c *api.APIClient, id string) (*engine.Proxy, string, error) {
	px, err := c.GetProxy(ctx, id)
	if err != nil {
		return nil, "", err
	}
	ep := &engine.Proxy{Name: px.Name, Type: px.ProxyType, Host: px.Host, Port: int(px.Port), Username: px.Username, Bypass: px.Bypass}
	warning := ""
	if px.Username != "" {
		pw, ok := "", false
		if a.store != nil {
			if pw, ok, err = a.store.ProxyPassword(ctx, id); err != nil {
				return nil, "", err
			}
		}
		if ok {
			ep.Password = pw
		} else {
			warning = "proxy password not set on this machine (" + px.Name + ") — sent without credentials"
		}
	}
	return ep, warning, nil
}

type proxyAndWarning struct {
	proxy   *engine.Proxy
	warning string
}

func sameNodeProxy(a, b api.NodeProxy) bool {
	id := func(p api.NodeProxy) string {
		if p.ProxyID == nil {
			return ""
		}
		return *p.ProxyID
	}
	return a.Mode == b.Mode && id(a) == id(b)
}

// MoveProxy moves a proxy up (offset -1) or down (+1) in the project's order.
func (a *App) MoveProxy(projectID, proxyID string, offset int) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		list, err := c.ListProxies(ctx, projectID)
		if err != nil {
			return err
		}
		ids := make([]string, len(list))
		for i, p := range list {
			ids[i] = p.ID
		}
		if moved, ok := envs.Move(ids, proxyID, offset); ok {
			return c.ReorderProxies(ctx, projectID, moved)
		}
		return nil
	})
}
