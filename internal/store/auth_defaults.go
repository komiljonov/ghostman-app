package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Auth-field memory (internal/authmemory): per project + auth type, the JSON of
// the last saved fields. Local only — values may be literal secrets; never log them.

// AuthDefault returns the remembered fields of a type; ok is false when none are stored.
func (s *Store) AuthDefault(ctx context.Context, projectID, authType string) (string, bool, error) {
	v, err := s.GetAuthDefault(ctx, GetAuthDefaultParams{ProjectID: projectID, AuthType: authType})
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// SetAuthDefault stores (replaces) the remembered fields of a type.
func (s *Store) SetAuthDefault(ctx context.Context, projectID, authType, fieldsJSON string) error {
	return s.PutAuthDefault(ctx, PutAuthDefaultParams{
		ProjectID: projectID, AuthType: authType, FieldsJson: fieldsJSON, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
}
