package api

import (
	"context"
	"log/slog"
	"strings"
)

// CopySuffix is appended to a duplicated request's name.
const CopySuffix = " copy"

// DuplicateRequest copies a request into the same folder as "<name> copy". The
// server has no copy endpoint, so it is composed: read the original, create the
// copy (name, folder, method, URL), then patch in headers, query params and body.
// If a step after the create fails, the half-made copy is deleted (best effort)
// and the error of the failed step is returned.
func (c *APIClient) DuplicateRequest(ctx context.Context, id string) (RequestSummary, error) {
	orig, err := c.GetRequest(ctx, id)
	if err != nil {
		return RequestSummary{}, err
	}
	created, err := c.CreateRequest(ctx, orig.ProjectID, NewRequest{
		Name:     strings.TrimSpace(orig.Name) + CopySuffix,
		FolderID: orig.FolderID,
		Method:   orig.Method,
		URL:      orig.URL,
	})
	if err != nil {
		return RequestSummary{}, err
	}
	headers, query, body := orig.Headers, orig.QueryParams, orig.Body
	method, url := orig.Method, orig.URL
	updated, err := c.UpdateRequest(ctx, created.ID, RequestPatch{
		Method: &method, URL: &url, Headers: &headers, QueryParams: &query, Body: &body,
	})
	if err != nil {
		if delErr := c.DeleteRequest(context.WithoutCancel(ctx), created.ID); delErr != nil {
			slog.Warn("duplicate: could not remove the partial copy", "request", created.ID, "err", delErr)
		}
		return RequestSummary{}, err
	}
	return updated.RequestSummary, nil
}
