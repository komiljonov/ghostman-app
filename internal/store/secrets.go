package store

import (
	"context"
	"database/sql"
	"errors"
)

// Secret variable values live only in this table (never on the server). Never log them.

// SecretMap returns an environment's local secret values by variable key.
func (s *Store) SecretMap(ctx context.Context, environmentID string) (map[string]string, error) {
	rows, err := s.ListSecretValues(ctx, environmentID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[r.Key] = r.Value
	}
	return out, nil
}

// Secret returns one local secret value; ok is false when none is stored.
func (s *Store) Secret(ctx context.Context, environmentID, key string) (string, bool, error) {
	v, err := s.GetSecretValue(ctx, GetSecretValueParams{EnvironmentID: environmentID, Key: key})
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// PutSecret stores (or replaces) a local secret value.
func (s *Store) PutSecret(ctx context.Context, environmentID, key, value string) error {
	return s.PutSecretValue(ctx, PutSecretValueParams{EnvironmentID: environmentID, Key: key, Value: value})
}

// DeleteSecret removes one local secret value.
func (s *Store) DeleteSecret(ctx context.Context, environmentID, key string) error {
	return s.DeleteSecretValue(ctx, DeleteSecretValueParams{EnvironmentID: environmentID, Key: key})
}

// DeleteSecrets removes every local secret value of an environment.
func (s *Store) DeleteSecrets(ctx context.Context, environmentID string) error {
	return s.DeleteSecretValuesForEnvironment(ctx, environmentID)
}

// RenameSecret moves a local secret value to a new key (replacing one stored there).
func (s *Store) RenameSecret(ctx context.Context, environmentID, oldKey, newKey string) error {
	return s.RenameSecretKey(ctx, RenameSecretKeyParams{EnvironmentID: environmentID, OldKey: oldKey, NewKey: newKey})
}
