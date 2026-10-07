package store

import (
	"context"
	"database/sql"
	"errors"
)

// Per-request settings kept only on this machine. A request without a row uses
// the defaults: redirects are followed.

// FollowRedirects reports whether sends of a request follow redirects (default true).
func (s *Store) FollowRedirects(ctx context.Context, requestID string) (bool, error) {
	v, err := s.GetFollowRedirects(ctx, requestID)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	return v != 0, nil
}

// SetFollowRedirects stores the follow-redirects toggle of a request.
func (s *Store) SetFollowRedirects(ctx context.Context, requestID string, follow bool) error {
	var v int64
	if follow {
		v = 1
	}
	return s.PutFollowRedirects(ctx, PutFollowRedirectsParams{RequestID: requestID, FollowRedirects: v})
}
