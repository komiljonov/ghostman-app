package store

import (
	"context"
	"database/sql"
	"errors"
)

// Keys of the settings table.
const (
	SettingSessionToken = "session_token"
	SettingServerURL    = "server_url"
)

// Setting returns the value stored under key; ok is false when the key is absent.
func (s *Store) Setting(ctx context.Context, key string) (value string, ok bool, err error) {
	value, err = s.GetSetting(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// PutSetting inserts or replaces the value stored under key.
func (s *Store) PutSetting(ctx context.Context, key, value string) error {
	return s.SetSetting(ctx, SetSettingParams{Key: key, Value: value})
}
