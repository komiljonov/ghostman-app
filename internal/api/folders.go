package api

import (
	"context"
	"net/http"
	"net/url"
)

// Folder is one entry of a project's flat folder list. ParentID is nil at the project root.
type Folder struct {
	ID        string  `json:"id"`
	ParentID  *string `json:"parent_id"`
	Name      string  `json:"name"`
	SortOrder int32   `json:"sort_order"`
	CreatedAt string  `json:"created_at"`
}

// FolderDetail is a single folder as returned by create/rename/move.
type FolderDetail struct {
	ID        string  `json:"id"`
	ProjectID string  `json:"project_id"`
	ParentID  *string `json:"parent_id"`
	Name      string  `json:"name"`
	SortOrder int32   `json:"sort_order"`
	CreatedAt string  `json:"created_at"`
}

func folderPath(id string) string { return "/api/v1/folders/" + url.PathEscape(id) }

// CreateFolder creates a folder at the project root (parentID nil) or inside a folder.
func (c *APIClient) CreateFolder(ctx context.Context, projectID, name string, parentID *string) (FolderDetail, error) {
	var out FolderDetail
	body := map[string]any{"name": name, "parent_id": parentID} // nil encodes as null = root
	err := c.do(ctx, http.MethodPost, projectPath(projectID)+"/folders", body, &out)
	return out, err
}

// ListFolders returns every folder of a project as a flat list.
func (c *APIClient) ListFolders(ctx context.Context, projectID string) ([]Folder, error) {
	out := []Folder{}
	err := c.do(ctx, http.MethodGet, projectPath(projectID)+"/folders", nil, &out)
	return out, err
}

// RenameFolder renames a folder.
func (c *APIClient) RenameFolder(ctx context.Context, id, name string) (FolderDetail, error) {
	var out FolderDetail
	err := c.do(ctx, http.MethodPatch, folderPath(id), map[string]string{"name": name}, &out)
	return out, err
}

// MoveFolder moves a folder under parentID (nil = project root), after its new
// siblings. The server rejects moving a folder into itself or a descendant.
func (c *APIClient) MoveFolder(ctx context.Context, id string, parentID *string) (FolderDetail, error) {
	var out FolderDetail
	err := c.do(ctx, http.MethodPost, folderPath(id)+"/move", map[string]any{"parent_id": parentID}, &out)
	return out, err
}

// ReorderFolders sets the order of the folders directly under parentID (nil =
// root). folderIDs must list exactly those siblings.
func (c *APIClient) ReorderFolders(ctx context.Context, projectID string, parentID *string, folderIDs []string) error {
	body := map[string]any{"project_id": projectID, "parent_id": parentID, "folder_ids": nonNil(folderIDs)}
	return c.do(ctx, http.MethodPut, "/api/v1/folders/order", body, nil)
}

// DeleteFolder deletes a folder and everything inside it.
func (c *APIClient) DeleteFolder(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, folderPath(id), nil, nil)
}
