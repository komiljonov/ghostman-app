package api

import (
	"context"
	"log/slog"
	"strings"
)

// CopySuffix is appended to a duplicated request's name.
const CopySuffix = " copy"

// DuplicateRequest copies a request into the same folder as "<name> copy". The
// server has no copy endpoint, so it is composed (CreateRequestFrom).
func (c *APIClient) DuplicateRequest(ctx context.Context, id string) (RequestSummary, error) {
	orig, err := c.GetRequest(ctx, id)
	if err != nil {
		return RequestSummary{}, err
	}
	return c.CreateRequestFrom(ctx, orig.ProjectID, orig.FolderID, strings.TrimSpace(orig.Name)+CopySuffix, orig.Draft())
}

// CreateRequestFrom creates a request with the given contents: create (name,
// folder, method, URL), then patch in headers, query params and body. If the
// patch fails (auth included, every field), the half-made request is deleted (best effort) and the patch's
// error is returned. Used by duplicate and by "restore from history".
func (c *APIClient) CreateRequestFrom(ctx context.Context, projectID string, folderID *string, name string, d RequestDraft) (RequestSummary, error) {
	created, err := c.CreateRequest(ctx, projectID, NewRequest{Name: name, FolderID: folderID, Method: d.Method, URL: d.URL})
	if err != nil {
		return RequestSummary{}, err
	}
	headers, query, body := NormalizeRows(d.Headers), NormalizeRows(d.QueryParams), NormalizeBody(d.Body)
	method, url := d.Method, d.URL
	patch := RequestPatch{
		Method: &method, URL: &url, Headers: &headers, QueryParams: &query, Body: &body, Auth: FullAuthPatch(d.Auth),
	}
	if d.ResponseFilter != "" {
		patch.ResponseFilter = &d.ResponseFilter // a copy keeps its filter
	}
	updated, err := c.UpdateRequest(ctx, created.ID, patch)
	if err != nil {
		if delErr := c.DeleteRequest(context.WithoutCancel(ctx), created.ID); delErr != nil {
			slog.Warn("create request: could not remove the partial copy", "request", created.ID, "err", delErr)
		}
		return RequestSummary{}, err
	}
	return updated.RequestSummary, nil
}
