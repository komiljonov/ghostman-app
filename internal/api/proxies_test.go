package api

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestProxyEndpoints(t *testing.T) {
	ctx := context.Background()
	const proxy = `{"id":"x1","project_id":"p1","name":"Corp","proxy_type":"http","host":"proxy.corp","port":3128,"username":"me","bypass":"localhost","sort_order":0,"created_at":"c"}`
	pid := "x1"
	tests := []struct {
		name                 string
		status               int
		resp                 string
		call                 func(c *APIClient) (any, error)
		wantMethod, wantPath string
		wantRaw              string
		want                 any
	}{
		{
			name: "create", status: 201, resp: proxy,
			call: func(c *APIClient) (any, error) {
				p, err := c.CreateProxy(ctx, "p1", NewProxy{Name: "Corp", ProxyType: ProxyTypeHTTP, Host: "proxy.corp", Port: 3128, Username: "me", Bypass: "localhost"})
				return p.Port, err
			},
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/proxies",
			wantRaw: `{"name":"Corp","proxy_type":"http","host":"proxy.corp","port":3128,"username":"me","bypass":"localhost"}`,
			want:    int32(3128),
		},
		{
			name: "list", status: 200, resp: "[" + proxy + "]",
			call:       func(c *APIClient) (any, error) { l, err := c.ListProxies(ctx, "p1"); return len(l), err },
			wantMethod: "GET", wantPath: "/api/v1/projects/p1/proxies", want: 1,
		},
		{
			name: "update sends only the changed fields", status: 200, resp: proxy,
			call: func(c *APIClient) (any, error) {
				port, by := int32(8080), ""
				_, err := c.UpdateProxy(ctx, "x1", ProxyPatch{Port: &port, Bypass: &by})
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/proxies/x1", wantRaw: `{"port":8080,"bypass":""}`,
		},
		{
			name: "delete", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteProxy(ctx, "x1") },
			wantMethod: "DELETE", wantPath: "/api/v1/proxies/x1",
		},
		{
			name: "reorder", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.ReorderProxies(ctx, "p1", []string{"x2", "x1"}) },
			wantMethod: "PUT", wantPath: "/api/v1/proxies/order", wantRaw: `{"project_id":"p1","proxy_ids":["x2","x1"]}`,
		},
		{
			name: "request: use a proxy", status: 200, resp: `{"id":"r1","proxy":{"mode":"proxy","proxy_id":"x1"}}`,
			call: func(c *APIClient) (any, error) {
				r, err := c.SetRequestProxy(ctx, "r1", NodeProxy{Mode: ProxyModeProxy, ProxyID: &pid})
				return r.Proxy, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/requests/r1", wantRaw: `{"proxy":{"mode":"proxy","proxy_id":"x1"}}`,
			want: NodeProxy{Mode: ProxyModeProxy, ProxyID: &pid},
		},
		{
			name: "request: other modes carry no id", status: 200, resp: `{"id":"r1","proxy":{"mode":"none","proxy_id":null}}`,
			call: func(c *APIClient) (any, error) {
				_, err := c.SetRequestProxy(ctx, "r1", NodeProxy{Mode: ProxyModeNone, ProxyID: &pid})
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/requests/r1", wantRaw: `{"proxy":{"mode":"none"}}`,
		},
		{
			name: "folder settings carry the proxy object", status: 200, resp: `{"id":"f1"}`,
			call: func(c *APIClient) (any, error) {
				follow := "on"
				_, err := c.UpdateFolderSettings(ctx, "f1", FolderSettingsPatch{FollowRedirects: &follow}.WithProxy(NodeProxy{Mode: ProxyModeGlobal}))
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/folders/f1", wantRaw: `{"follow_redirects":"on","proxy":{"mode":"global"}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, rec := replayServer(t, tt.status, tt.resp)
			got, err := tt.call(c)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rec.method != tt.wantMethod || rec.path != tt.wantPath {
				t.Errorf("request = %s %s, want %s %s", rec.method, rec.path, tt.wantMethod, tt.wantPath)
			}
			if rec.raw != tt.wantRaw {
				t.Errorf("body = %s\nwant   %s", rec.raw, tt.wantRaw)
			}
			if strings.Contains(strings.ToLower(rec.raw), "password") {
				t.Errorf("a password field reached the server: %s", rec.raw)
			}
			if tt.want != nil && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got  %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestNormalizeNodeProxy(t *testing.T) {
	id := "x1"
	for _, tt := range []struct{ in, want NodeProxy }{
		{NodeProxy{}, NodeProxy{Mode: ProxyModeInherit}},
		{NodeProxy{Mode: "weird", ProxyID: &id}, NodeProxy{Mode: ProxyModeInherit}},
		{NodeProxy{Mode: ProxyModeNone, ProxyID: &id}, NodeProxy{Mode: ProxyModeNone}},
		{NodeProxy{Mode: ProxyModeProxy, ProxyID: &id}, NodeProxy{Mode: ProxyModeProxy, ProxyID: &id}},
		{NodeProxy{Mode: ProxyModeProxy}, NodeProxy{Mode: ProxyModeProxy}}, // a deleted proxy: the UI resolves it as inherit
	} {
		if got := NormalizeNodeProxy(tt.in); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("Normalize(%+v) = %+v", tt.in, got)
		}
	}
}
