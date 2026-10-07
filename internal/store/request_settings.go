package store

import (
	"context"
	"strconv"
)

// Redirect settings on this machine:
//   - the global follow-redirects setting (settings key follow_redirects_default;
//     true when unset) — still local;
//   - request_settings: the old per-request overrides, read once to push them to
//     the server (follow_redirects lives on requests/folders there); the table is
//     dropped right after that single attempt.

const settingFollowRedirectsDefault = "follow_redirects_default"

// LegacyRequestSetting is one old local override still to be pushed.
type LegacyRequestSetting struct {
	RequestID string
	Follow    bool
}

// hasRequestSettingsTable: false once the one-time push dropped it.
func (s *Store) hasRequestSettingsTable(ctx context.Context) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'request_settings'`).Scan(&n)
	return n > 0, err
}

// LegacyRequestSettings returns the old overrides not pushed yet (none once the
// table is gone).
func (s *Store) LegacyRequestSettings(ctx context.Context) ([]LegacyRequestSetting, error) {
	ok, err := s.hasRequestSettingsTable(ctx)
	if err != nil || !ok {
		return nil, err
	}
	rows, err := s.ListRequestSettings(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]LegacyRequestSetting, 0, len(rows))
	for _, r := range rows {
		out = append(out, LegacyRequestSetting{RequestID: r.RequestID, Follow: r.FollowRedirects != 0})
	}
	return out, nil
}

// DropLegacyRequestSettings removes the table once every row was handled.
func (s *Store) DropLegacyRequestSettings(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DROP TABLE IF EXISTS request_settings`)
	return err
}

// FollowRedirectsDefault is the global setting (true when never set or unreadable).
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

// SetFollowRedirectsDefault stores the global setting.
func (s *Store) SetFollowRedirectsDefault(ctx context.Context, follow bool) error {
	return s.PutSetting(ctx, settingFollowRedirectsDefault, strconv.FormatBool(follow))
}
