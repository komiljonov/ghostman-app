package store

import "context"

// Local paths of multipart file fields (never on the server; see migration 00011).

// RequestFileMap returns a request's local file paths by field key.
func (s *Store) RequestFileMap(ctx context.Context, requestID string) (map[string]string, error) {
	rows, err := s.ListRequestFiles(ctx, requestID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[r.FieldKey] = r.Path
	}
	return out, nil
}

// PutRequestFilePath stores (or replaces) a field's local path.
func (s *Store) PutRequestFilePath(ctx context.Context, requestID, key, path string) error {
	return s.PutRequestFile(ctx, PutRequestFileParams{RequestID: requestID, FieldKey: key, Path: path})
}

// DeleteRequestFilePath forgets a field's local path.
func (s *Store) DeleteRequestFilePath(ctx context.Context, requestID, key string) error {
	return s.DeleteRequestFile(ctx, DeleteRequestFileParams{RequestID: requestID, FieldKey: key})
}

// RenameRequestFilePath moves a path to a field's new key (replacing one stored there).
func (s *Store) RenameRequestFilePath(ctx context.Context, requestID, oldKey, newKey string) error {
	return s.RenameRequestFileKey(ctx, RenameRequestFileKeyParams{RequestID: requestID, OldKey: oldKey, NewKey: newKey})
}
