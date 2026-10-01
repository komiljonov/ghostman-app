package api

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestEnvironmentEndpoints(t *testing.T) {
	ctx := context.Background()
	const env = `{"id":"e1","project_id":"p1","name":"dev","sort_order":0,"created_at":"x"}`
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
			name: "create environment", status: 201, resp: env,
			call:       func(c *APIClient) (any, error) { return c.CreateEnvironment(ctx, "p1", "dev") },
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/environments", wantRaw: `{"name":"dev"}`,
			want: EnvironmentDetail{ID: "e1", ProjectID: "p1", Name: "dev", CreatedAt: "x"},
		},
		{
			name: "list environments", status: 200, resp: `[{"id":"e1","name":"dev","sort_order":0,"created_at":"x"}]`,
			call:       func(c *APIClient) (any, error) { return c.ListEnvironments(ctx, "p1") },
			wantMethod: "GET", wantPath: "/api/v1/projects/p1/environments",
			want: []Environment{{ID: "e1", Name: "dev", CreatedAt: "x"}},
		},
		{
			name: "rename environment", status: 200, resp: env,
			call:       func(c *APIClient) (any, error) { e, err := c.RenameEnvironment(ctx, "e1", "dev"); return e.ID, err },
			wantMethod: "PATCH", wantPath: "/api/v1/environments/e1", wantRaw: `{"name":"dev"}`, want: "e1",
		},
		{
			name: "delete environment", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteEnvironment(ctx, "e1") },
			wantMethod: "DELETE", wantPath: "/api/v1/environments/e1",
		},
		{
			name: "reorder environments", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.ReorderEnvironments(ctx, "p1", []string{"e2", "e1"}) },
			wantMethod: "PUT", wantPath: "/api/v1/environments/order",
			wantRaw: `{"environment_ids":["e2","e1"],"project_id":"p1"}`,
		},
		{
			name: "create secret variable carries no value field", status: 201,
			resp: `{"id":"v1","key":"TOKEN","type":"secret","value":null,"sort_order":0}`,
			call: func(c *APIClient) (any, error) {
				return c.CreateVariable(ctx, "e1", NewVariable{Key: "TOKEN", Type: VarSecret})
			},
			wantMethod: "POST", wantPath: "/api/v1/environments/e1/variables", wantRaw: `{"key":"TOKEN","type":"secret"}`,
			want: Variable{ID: "v1", Key: "TOKEN", Type: VarSecret},
		},
		{
			name: "list variables keeps null secret values", status: 200,
			resp: `[{"id":"v1","key":"BASE","type":"regular","value":"https://x","sort_order":0},
				{"id":"v2","key":"TOKEN","type":"secret","value":null,"sort_order":1}]`,
			call:       func(c *APIClient) (any, error) { return c.ListVariables(ctx, "e1") },
			wantMethod: "GET", wantPath: "/api/v1/environments/e1/variables",
			want: []Variable{{ID: "v1", Key: "BASE", Type: VarRegular, Value: strPtr("https://x")},
				{ID: "v2", Key: "TOKEN", Type: VarSecret, SortOrder: 1}},
		},
		{
			name: "update only the key", status: 200, resp: `{"id":"v1","key":"K2","type":"secret","value":null,"sort_order":0}`,
			call: func(c *APIClient) (any, error) {
				v, err := c.UpdateVariable(ctx, "v1", VariablePatch{Key: strPtr("K2")})
				return v.Key, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/variables/v1", wantRaw: `{"key":"K2"}`, want: "K2",
		},
		{
			name: "update a regular value", status: 200, resp: `{"id":"v1","key":"BASE","type":"regular","value":"y","sort_order":0}`,
			call: func(c *APIClient) (any, error) {
				_, err := c.UpdateVariable(ctx, "v1", VariablePatch{SetValue: true, Value: strPtr("y")})
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/variables/v1", wantRaw: `{"value":"y"}`,
		},
		{
			name: "make secret sends only the type", status: 200, resp: `{"id":"v1","key":"BASE","type":"secret","value":null,"sort_order":0}`,
			call: func(c *APIClient) (any, error) {
				_, err := c.UpdateVariable(ctx, "v1", VariablePatch{Type: strPtr(VarSecret)})
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/variables/v1", wantRaw: `{"type":"secret"}`,
		},
		{
			name: "clearing a value sends null", status: 200, resp: `{"id":"v1","key":"BASE","type":"regular","value":null,"sort_order":0}`,
			call: func(c *APIClient) (any, error) {
				_, err := c.UpdateVariable(ctx, "v1", VariablePatch{SetValue: true})
				return nil, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/variables/v1", wantRaw: `{"value":null}`,
		},
		{
			name: "delete variable", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteVariable(ctx, "v1") },
			wantMethod: "DELETE", wantPath: "/api/v1/variables/v1",
		},
		{
			name: "reorder variables", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.ReorderVariables(ctx, "e1", []string{"v2", "v1"}) },
			wantMethod: "PUT", wantPath: "/api/v1/variables/order",
			wantRaw: `{"environment_id":"e1","variable_ids":["v2","v1"]}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, rec := replayServer(t, tt.status, tt.resp)
			got, err := tt.call(c)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rec.method != tt.wantMethod || rec.path != tt.wantPath || rec.auth != "Bearer tok" {
				t.Errorf("request = %s %s (auth %q), want %s %s", rec.method, rec.path, rec.auth, tt.wantMethod, tt.wantPath)
			}
			if rec.raw != tt.wantRaw {
				t.Errorf("body = %s\nwant   %s", rec.raw, tt.wantRaw)
			}
			if tt.want != nil && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got  %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestUpdateVariableRefusesSecretValue(t *testing.T) {
	c, rec := replayServer(t, 200, `{}`)
	_, err := c.UpdateVariable(context.Background(), "v1", VariablePatch{Type: strPtr(VarSecret), SetValue: true, Value: strPtr("hunter2")})
	if !errors.Is(err, ErrSecretValue) {
		t.Fatalf("err = %v, want ErrSecretValue", err)
	}
	if rec.method != "" {
		t.Fatalf("a request was sent: %s %s %s", rec.method, rec.path, rec.raw)
	}
}

func TestVariableErrorsSurfaceServerMessage(t *testing.T) {
	c, _ := replayServer(t, 409, `{"error":{"code":"conflict","message":"a variable with that key already exists in this environment"}}`)
	_, err := c.CreateVariable(context.Background(), "e1", NewVariable{Key: "A", Type: VarRegular})
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Message != "a variable with that key already exists in this environment" {
		t.Fatalf("err = %v", err)
	}
}
