package api

import "context"

// Tree node kinds for Place.
const (
	NodeFolder  = "folder"
	NodeRequest = "request"
)

// Placement is where a dragged tree node goes. Parent ids are nil at the project
// root. OrderedIDs, when non-nil, is the full same-kind sibling list of the target
// parent in its new order (the dragged node included), as the reorder endpoints
// require; nil means "wherever the move puts it" (the end).
type Placement struct {
	Kind          string
	ProjectID     string
	ID            string
	CurrentParent *string
	TargetParent  *string
	OrderedIDs    []string
}

// Place moves a folder or request (if the parent changes) and then applies the
// sibling order (if given): one call for one drop, so the UI re-fetches once.
// Errors come back as-is (e.g. the server's 400 for a folder moved into its own
// subtree); if the move succeeded and the reorder failed, the node stays moved.
func (c *APIClient) Place(ctx context.Context, p Placement) error {
	if !sameParent(p.CurrentParent, p.TargetParent) {
		var err error
		if p.Kind == NodeFolder {
			_, err = c.MoveFolder(ctx, p.ID, p.TargetParent)
		} else {
			_, err = c.MoveRequest(ctx, p.ID, p.TargetParent)
		}
		if err != nil {
			return err
		}
	}
	if p.OrderedIDs == nil {
		return nil
	}
	if p.Kind == NodeFolder {
		return c.ReorderFolders(ctx, p.ProjectID, p.TargetParent, p.OrderedIDs)
	}
	return c.ReorderRequests(ctx, p.ProjectID, p.TargetParent, p.OrderedIDs)
}

func sameParent(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
