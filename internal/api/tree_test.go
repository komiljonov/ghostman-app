package api

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func strPtr(s string) *string { return &s }

func TestFolderAndRequestEndpoints(t *testing.T) {
	ctx := context.Background()
	const folder = `{"id":"f2","project_id":"p1","parent_id":"f1","name":"B","sort_order":0,"created_at":"x"}`
	const rootFolder = `{"id":"f1","project_id":"p1","parent_id":null,"name":"A","sort_order":0,"created_at":"x"}`
	const summary = `{"id":"r1","project_id":"p1","folder_id":null,"name":"R1","method":"GET","url":"","sort_order":0,"created_at":"x","updated_at":"y"}`
	const detail = `{"id":"r1","project_id":"p1","folder_id":"f1","name":"R1","method":"POST","url":"https://x.io","sort_order":0,
		"created_at":"x","updated_at":"y","headers":[{"key":"A","value":"1","enabled":true}],"query_params":[],"body":{"type":"none"}}`

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
			name: "create root folder sends parent_id null", status: 201, resp: rootFolder,
			call:       func(c *APIClient) (any, error) { return c.CreateFolder(ctx, "p1", "A", nil) },
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/folders", wantRaw: `{"name":"A","parent_id":null}`,
			want: FolderDetail{ID: "f1", ProjectID: "p1", ParentID: nil, Name: "A", CreatedAt: "x"},
		},
		{
			name: "create nested folder", status: 201, resp: folder,
			call:       func(c *APIClient) (any, error) { return c.CreateFolder(ctx, "p1", "B", strPtr("f1")) },
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/folders", wantRaw: `{"name":"B","parent_id":"f1"}`,
			want: FolderDetail{ID: "f2", ProjectID: "p1", ParentID: strPtr("f1"), Name: "B", CreatedAt: "x"},
		},
		{
			name: "list folders keeps null and non-null parents", status: 200,
			resp:       `[{"id":"f1","parent_id":null,"name":"A","sort_order":0,"created_at":"x"},{"id":"f2","parent_id":"f1","name":"B","sort_order":0,"created_at":"x"}]`,
			call:       func(c *APIClient) (any, error) { return c.ListFolders(ctx, "p1") },
			wantMethod: "GET", wantPath: "/api/v1/projects/p1/folders",
			want: []Folder{{ID: "f1", Name: "A", Auth: defAuth, CreatedAt: "x"}, {ID: "f2", ParentID: strPtr("f1"), Name: "B", Auth: defAuth, CreatedAt: "x"}},
		},
		{
			name: "rename folder", status: 200, resp: folder,
			call:       func(c *APIClient) (any, error) { f, err := c.RenameFolder(ctx, "f2", "B2"); return f.ID, err },
			wantMethod: "PATCH", wantPath: "/api/v1/folders/f2", wantRaw: `{"name":"B2"}`, want: "f2",
		},
		{
			name: "move folder to root sends explicit null", status: 200, resp: rootFolder,
			call:       func(c *APIClient) (any, error) { f, err := c.MoveFolder(ctx, "f2", nil); return f.ID, err },
			wantMethod: "POST", wantPath: "/api/v1/folders/f2/move", wantRaw: `{"parent_id":null}`, want: "f1",
		},
		{
			name: "reorder root folders", status: 204,
			call: func(c *APIClient) (any, error) {
				return nil, c.ReorderFolders(ctx, "p1", nil, []string{"f3", "f1"})
			},
			wantMethod: "PUT", wantPath: "/api/v1/folders/order",
			wantRaw: `{"folder_ids":["f3","f1"],"parent_id":null,"project_id":"p1"}`,
		},
		{
			name: "delete folder", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteFolder(ctx, "f1") },
			wantMethod: "DELETE", wantPath: "/api/v1/folders/f1",
		},
		{
			name: "create request with defaults", status: 201, resp: summary,
			call:       func(c *APIClient) (any, error) { return c.CreateRequest(ctx, "p1", NewRequest{Name: "R1"}) },
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/requests", wantRaw: `{"folder_id":null,"name":"R1"}`,
			want: RequestSummary{ID: "r1", ProjectID: "p1", Name: "R1", Method: "GET", CreatedAt: "x", UpdatedAt: "y"},
		},
		{
			name: "create request in folder with method and url", status: 201, resp: summary,
			call: func(c *APIClient) (any, error) {
				r, err := c.CreateRequest(ctx, "p1", NewRequest{Name: "R2", FolderID: strPtr("f2"), Method: "POST", URL: "https://x.io"})
				return r.ID, err
			},
			wantMethod: "POST", wantPath: "/api/v1/projects/p1/requests",
			wantRaw: `{"folder_id":"f2","method":"POST","name":"R2","url":"https://x.io"}`, want: "r1",
		},
		{
			name: "list requests", status: 200, resp: `[` + summary + `]`,
			call:       func(c *APIClient) (any, error) { return c.ListRequests(ctx, "p1") },
			wantMethod: "GET", wantPath: "/api/v1/projects/p1/requests",
			want: []RequestSummary{{ID: "r1", ProjectID: "p1", Name: "R1", Method: "GET", Auth: defAuth, CreatedAt: "x", UpdatedAt: "y"}},
		},
		{
			name: "get request decodes rows and body", status: 200, resp: detail,
			call:       func(c *APIClient) (any, error) { return c.GetRequest(ctx, "r1") },
			wantMethod: "GET", wantPath: "/api/v1/requests/r1",
			want: Request{
				RequestSummary: RequestSummary{ID: "r1", ProjectID: "p1", FolderID: strPtr("f1"), Name: "R1", Method: "POST",
					URL: "https://x.io", CreatedAt: "x", UpdatedAt: "y",
					Auth: Auth{Type: AuthInherit, APIKeyIn: APIKeyInHeader}}, // absent (older server) -> defaults
				Headers:     []KeyValue{{Key: "A", Value: "1", Enabled: true}},
				QueryParams: []KeyValue{},
				Body:        RequestBody{Type: BodyNone, Fields: []KeyValue{}},
			},
		},
		{
			name: "partial update sends only set fields", status: 200, resp: detail,
			call: func(c *APIClient) (any, error) {
				r, err := c.UpdateRequest(ctx, "r1", RequestPatch{Name: strPtr("Renamed")})
				return r.ID, err
			},
			wantMethod: "PATCH", wantPath: "/api/v1/requests/r1", wantRaw: `{"name":"Renamed"}`, want: "r1",
		},
		{
			name: "move request to folder", status: 200, resp: summary,
			call:       func(c *APIClient) (any, error) { r, err := c.MoveRequest(ctx, "r1", strPtr("f2")); return r.ID, err },
			wantMethod: "POST", wantPath: "/api/v1/requests/r1/move", wantRaw: `{"folder_id":"f2"}`, want: "r1",
		},
		{
			name: "reorder requests in folder", status: 204,
			call: func(c *APIClient) (any, error) {
				return nil, c.ReorderRequests(ctx, "p1", strPtr("f2"), []string{"r2", "r1"})
			},
			wantMethod: "PUT", wantPath: "/api/v1/requests/order",
			wantRaw: `{"folder_id":"f2","project_id":"p1","request_ids":["r2","r1"]}`,
		},
		{
			name: "delete request", status: 204,
			call:       func(c *APIClient) (any, error) { return nil, c.DeleteRequest(ctx, "r1") },
			wantMethod: "DELETE", wantPath: "/api/v1/requests/r1",
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

func TestTreeEndpointErrors(t *testing.T) {
	ctx := context.Background()
	env := func(msg string) string { return `{"error":{"code":"bad_request","message":"` + msg + `"}}` }
	tests := []struct {
		name    string
		resp    string
		call    func(c *APIClient) error
		wantMsg string
	}{
		{
			// Spec step 4: the client hides these targets, but the server's answer must still surface.
			"move folder into its descendant", env("a folder cannot be moved into itself or its own subfolder"),
			func(c *APIClient) error { _, err := c.MoveFolder(ctx, "fA", strPtr("fB")); return err },
			"a folder cannot be moved into itself or its own subfolder",
		},
		{
			"reorder folders not exact set", env("folder_ids must list all 3 folders under this parent, got 2"),
			func(c *APIClient) error { return c.ReorderFolders(ctx, "p1", nil, []string{"f1", "f2"}) },
			"folder_ids must list all 3 folders under this parent, got 2",
		},
		{
			"reorder requests not exact set", env("request_ids must list all 2 requests in this folder, got 1"),
			func(c *APIClient) error { return c.ReorderRequests(ctx, "p1", strPtr("f1"), []string{"r1"}) },
			"request_ids must list all 2 requests in this folder, got 1",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := replayServer(t, 400, tt.resp)
			err := tt.call(c)
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.Status != 400 || apiErr.Message != tt.wantMsg {
				t.Fatalf("err = %#v, want 400 %q", err, tt.wantMsg)
			}
		})
	}
}

// defAuth is what an absent auth object (older server) decodes to in lists.
var defAuth = Auth{Type: AuthInherit, APIKeyIn: APIKeyInHeader}
