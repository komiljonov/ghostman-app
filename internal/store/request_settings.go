package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
)

// Redirect settings, kept only on this machine:
//   - a global default (settings key follow_redirects_default; true when unset);
//   - an optional per-request override (request_settings; no row = use the default).

const settingFollowRedirectsDefault = "follow_redirects_default"

// FollowRedirectsOverride returns a request's override, or nil when it uses the default.
func (s *Store) FollowRedirectsOverride(ctx context.Context, requestID string) (*bool, error) {
	v, err := s.GetFollowRedirects(ctx, requestID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	follow := v != 0
	return &follow, nil
}

// SetFollowRedirectsOverride stores a request's override; nil removes it (use the default).
func (s *Store) SetFollowRedirectsOverride(ctx context.Context, requestID string, follow *bool) error {
	if follow == nil {
		return s.DeleteFollowRedirects(ctx, requestID)
	}
	var v int64
	if *follow {
		v = 1
	}
	return s.PutFollowRedirects(ctx, PutFollowRedirectsParams{RequestID: requestID, FollowRedirects: v})
}

// FollowRedirectsDefault is the global default (true when never set or unreadable).
func (s *Store) FollowRedirectsDefault(ctx context.Context) (bool, error) {
	v, ok, err := s.Setting(ctx, settingFollowRedirectsDefault)
	if err != nil || !ok {
		return true, err
	}
	b, perr := strconv.ParseBool(v)
	if perr != nil {
		return true, nil
	}
	return b, nil
}

// SetFollowRedirectsDefault stores the global default.
func (s *Store) SetFollowRedirectsDefault(ctx context.Context, follow bool) error {
	return s.PutSetting(ctx, settingFollowRedirectsDefault, strconv.FormatBool(follow))
}
