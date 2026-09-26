package api

import (
	"context"
	"net/http"
	"net/url"
)

// RequestSummary is one entry of a project's flat request list. The server omits
// headers, query params and body from lists. FolderID is nil at the project root.
type RequestSummary struct {
	ID        string  `json:"id"`
	ProjectID string  `json:"project_id"`
	FolderID  *string `json:"folder_id"`
	Name      string  `json:"name"`
	Method    string  `json:"method"`
	URL       string  `json:"url"`
	SortOrder int32   `json:"sort_order"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

// Request is a full saved request. Headers, query params and body are passed
// through as the server's JSON (the editor that interprets them comes later).
type Request struct {
	RequestSummary
	Headers     any `json:"headers"`
	QueryParams any `json:"query_params"`
	Body        any `json:"body"`
}

// NewRequest is the input of CreateRequest. Empty Method/URL let the server
// apply its defaults; a nil FolderID creates the request at the project root.
type NewRequest struct {
	Name     string
	FolderID *string
	Method   string
	URL      string
}

// RequestPatch is a partial update; nil fields are left unchanged.
type RequestPatch struct {
	Name   *string `json:"name,omitempty"`
	Method *string `json:"method,omitempty"`
	URL    *string `json:"url,omitempty"`
}

func requestPath(id string) string { return "/api/v1/requests/" + url.PathEscape(id) }

// CreateRequest creates a request in a project.
func (c *APIClient) CreateRequest(ctx context.Context, projectID string, in NewRequest) (RequestSummary, error) {
	body := map[string]any{"name": in.Name, "folder_id": in.FolderID}
	if in.Method != "" {
		body["method"] = in.Method
	}
	if in.URL != "" {
		body["url"] = in.URL
	}
	var out RequestSummary
	err := c.do(ctx, http.MethodPost, projectPath(projectID)+"/requests", body, &out)
	return out, err
}

// ListRequests returns every request of a project as a flat list (no headers/body).
func (c *APIClient) ListRequests(ctx context.Context, projectID string) ([]RequestSummary, error) {
	out := []RequestSummary{}
	err := c.do(ctx, http.MethodGet, projectPath(projectID)+"/requests", nil, &out)
	return out, err
}

// GetRequest returns one request in full.
func (c *APIClient) GetRequest(ctx context.Context, id string) (Request, error) {
	var out Request
	err := c.do(ctx, http.MethodGet, requestPath(id), nil, &out)
	return out, err
}

// UpdateRequest applies a partial update (name / method / url).
func (c *APIClient) UpdateRequest(ctx context.Context, id string, patch RequestPatch) (Request, error) {
	var out Request
	err := c.do(ctx, http.MethodPatch, requestPath(id), patch, &out)
	return out, err
}

// MoveRequest moves a request into folderID (nil = project root), after its new siblings.
func (c *APIClient) MoveRequest(ctx context.Context, id string, folderID *string) (RequestSummary, error) {
	var out RequestSummary
	err := c.do(ctx, http.MethodPost, requestPath(id)+"/move", map[string]any{"folder_id": folderID}, &out)
	return out, err
}

// ReorderRequests sets the order of the requests directly in folderID (nil =
// root). requestIDs must list exactly those siblings.
func (c *APIClient) ReorderRequests(ctx context.Context, projectID string, folderID *string, requestIDs []string) error {
	body := map[string]any{"project_id": projectID, "folder_id": folderID, "request_ids": nonNil(requestIDs)}
	return c.do(ctx, http.MethodPut, "/api/v1/requests/order", body, nil)
}

// DeleteRequest deletes a request.
func (c *APIClient) DeleteRequest(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, requestPath(id), nil, nil)
}
