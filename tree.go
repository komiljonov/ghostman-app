package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"ghostman/internal/api"
	"ghostman/internal/session"
)

// Bound folder/request methods for the sidebar tree: thin {data, error} wrappers
// over *api.APIClient (see teams.go). Across the bridge an empty parent/folder id
// means the project root; it becomes nil (JSON null) for the server.

type FolderListResult struct {
	Data  []api.Folder     `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

type FolderResult struct {
	Data  *api.FolderDetail `json:"data"`
	Error *session.Problem  `json:"error,omitempty"`
}

type RequestListResult struct {
	Data  []api.RequestSummary `json:"data"`
	Error *session.Problem     `json:"error,omitempty"`
}

type RequestSummaryResult struct {
	Data  *api.RequestSummary `json:"data"`
	Error *session.Problem    `json:"error,omitempty"`
}

type RequestResult struct {
	Data  *api.Request     `json:"data"`
	Error *session.Problem `json:"error,omitempty"`
}

// rootAsNil maps "" (project root) to nil.
func rootAsNil(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

// ListFolders returns a project's folders as a flat list.
func (a *App) ListFolders(projectID string) FolderListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.Folder, error) {
		return c.ListFolders(ctx, projectID)
	})
	return FolderListResult{Data: v, Error: p}
}

// CreateFolder creates a folder inside parentID ("" = project root).
func (a *App) CreateFolder(projectID, name, parentID string) FolderResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.FolderDetail, error) {
		return c.CreateFolder(ctx, projectID, strings.TrimSpace(name), rootAsNil(parentID))
	})
	return FolderResult{Data: ptr(v, p), Error: p}
}

// RenameFolder renames a folder.
func (a *App) RenameFolder(id, name string) FolderResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.FolderDetail, error) {
		return c.RenameFolder(ctx, id, strings.TrimSpace(name))
	})
	return FolderResult{Data: ptr(v, p), Error: p}
}

// MoveFolder moves a folder into parentID ("" = project root).
func (a *App) MoveFolder(id, parentID string) FolderResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.FolderDetail, error) {
		return c.MoveFolder(ctx, id, rootAsNil(parentID))
	})
	return FolderResult{Data: ptr(v, p), Error: p}
}

// ReorderFolders sets the order of the folders directly under parentID ("" = root).
func (a *App) ReorderFolders(projectID, parentID string, folderIDs []string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return c.ReorderFolders(ctx, projectID, rootAsNil(parentID), folderIDs)
	})
}

// DeleteFolder deletes a folder and everything inside it.
func (a *App) DeleteFolder(id string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.DeleteFolder(ctx, id) })
}

// ListRequests returns a project's requests as a flat list (no headers/body).
func (a *App) ListRequests(projectID string) RequestListResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) ([]api.RequestSummary, error) {
		return c.ListRequests(ctx, projectID)
	})
	return RequestListResult{Data: v, Error: p}
}

// CreateRequest creates a request (server-default method/URL) in folderID ("" = root).
func (a *App) CreateRequest(projectID, name, folderID string) RequestSummaryResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.RequestSummary, error) {
		return c.CreateRequest(ctx, projectID, api.NewRequest{Name: strings.TrimSpace(name), FolderID: rootAsNil(folderID)})
	})
	return RequestSummaryResult{Data: ptr(v, p), Error: p}
}

// GetRequest returns one request in full.
func (a *App) GetRequest(id string) RequestResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) { return c.GetRequest(ctx, id) })
	return RequestResult{Data: ptr(v, p), Error: p}
}

// UpdateRequest applies a partial update (name / method / url; unset fields unchanged).
func (a *App) UpdateRequest(id string, patch api.RequestPatch) RequestResult {
	if patch.Name != nil {
		name := strings.TrimSpace(*patch.Name)
		patch.Name = &name
	}
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.Request, error) {
		return c.UpdateRequest(ctx, id, patch)
	})
	return RequestResult{Data: ptr(v, p), Error: p}
}

// DuplicateRequest copies a request into its folder as "<name> copy" (see
// api.DuplicateRequest: composed from get/create/update, rolled back on failure).
func (a *App) DuplicateRequest(id string) RequestSummaryResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.RequestSummary, error) {
		return c.DuplicateRequest(ctx, id)
	})
	return RequestSummaryResult{Data: ptr(v, p), Error: p}
}

// PlaceNode applies one tree drag-and-drop: kind is "folder" or "request";
// parents are "" for the root; orderedIDs (nil = keep where the move puts it) is
// the target parent's full same-kind sibling list in the new order. Move and
// reorder are composed in Go (api.Place) so the UI re-fetches once, no flicker.
func (a *App) PlaceNode(kind, projectID, id, currentParentID, targetParentID string, orderedIDs []string) EmptyResult {
	if kind != api.NodeFolder && kind != api.NodeRequest {
		return EmptyResult{Error: &session.Problem{Kind: session.KindInvalid, Message: `kind must be "folder" or "request"`}}
	}
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return c.Place(ctx, api.Placement{
			Kind: kind, ProjectID: projectID, ID: id,
			CurrentParent: rootAsNil(currentParentID), TargetParent: rootAsNil(targetParentID),
			OrderedIDs: orderedIDs,
		})
	})
}

// MoveRequest moves a request into folderID ("" = project root).
func (a *App) MoveRequest(id, folderID string) RequestSummaryResult {
	v, p := call(a, func(ctx context.Context, c *api.APIClient) (api.RequestSummary, error) {
		return c.MoveRequest(ctx, id, rootAsNil(folderID))
	})
	return RequestSummaryResult{Data: ptr(v, p), Error: p}
}

// ReorderRequests sets the order of the requests directly in folderID ("" = root).
func (a *App) ReorderRequests(projectID, folderID string, requestIDs []string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error {
		return c.ReorderRequests(ctx, projectID, rootAsNil(folderID), requestIDs)
	})
}

// DeleteRequest deletes a request.
func (a *App) DeleteRequest(id string) EmptyResult {
	return callEmpty(a, func(ctx context.Context, c *api.APIClient) error { return c.DeleteRequest(ctx, id) })
}

// treeStateKey is the local settings key holding a project's expanded folder ids.
func treeStateKey(projectID string) string { return "ui_tree_state_" + projectID }

// GetTreeState returns the folder ids expanded in a project's tree (local UI state).
func (a *App) GetTreeState(projectID string) []string {
	expanded := []string{}
	if a.store == nil || projectID == "" {
		return expanded
	}
	raw, ok, err := a.store.Setting(a.ctx, treeStateKey(projectID))
	if err != nil {
		slog.Error("load tree state", "err", err)
	}
	if !ok || err != nil {
		return expanded
	}
	if err := json.Unmarshal([]byte(raw), &expanded); err != nil {
		slog.Warn("ignoring corrupt tree state", "project", projectID, "err", err)
		return []string{}
	}
	return expanded
}

// SetTreeState saves which folders are expanded in a project's tree (local UI state).
func (a *App) SetTreeState(projectID string, expandedFolderIDs []string) EmptyResult {
	if a.store == nil || projectID == "" {
		return EmptyResult{}
	}
	if expandedFolderIDs == nil {
		expandedFolderIDs = []string{}
	}
	raw, err := json.Marshal(expandedFolderIDs)
	if err == nil {
		err = a.store.PutSetting(a.ctx, treeStateKey(projectID), string(raw))
	}
	if err != nil {
		return EmptyResult{Error: session.ProblemFrom(err)}
	}
	return EmptyResult{}
}
