package store

import (
	"context"
	"database/sql"
	"errors"
)

// Proxy passwords live only in this table (never on the server). Never log them.

// ProxyPassword returns a proxy's local password; ok is false when none is stored.
func (s *Store) ProxyPassword(ctx context.Context, proxyID string) (string, bool, error) {
	v, err := s.GetProxyPassword(ctx, proxyID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// SetProxyPassword stores a proxy's password ("" removes it).
func (s *Store) SetProxyPassword(ctx context.Context, proxyID, password string) error {
	if password == "" {
		return s.DeleteProxyPassword(ctx, proxyID)
	}
	return s.PutProxyPassword(ctx, PutProxyPasswordParams{ProxyID: proxyID, Password: password})
}
