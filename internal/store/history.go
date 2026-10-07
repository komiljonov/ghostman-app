package store

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strconv"
	"time"
)

// Local request/response history (this machine only, never synced). Rows hold the
// request in template AND resolved form — secret values included, deliberately —
// and the response body up to history_max_response_bytes.

const (
	SettingHistoryMaxEntries       = "history_max_entries"
	SettingHistoryMaxResponseBytes = "history_max_response_bytes"

	DefaultHistoryMaxEntries       = 1000
	DefaultHistoryMaxResponseBytes = 10 << 20 // 10 MB
)

// The values the Settings modal offers (0 = unlimited).
var (
	HistoryMaxEntriesChoices       = []int64{100, 500, 1000, 5000, 0}
	HistoryMaxResponseBytesChoices = []int64{1 << 20, 10 << 20, 50 << 20, 0}
)

// HistoryLimits are the retention settings.
type HistoryLimits struct {
	MaxEntries       int64 // 0 = never prune
	MaxResponseBytes int64 // 0 = store whole bodies
}

func (s *Store) intSetting(ctx context.Context, key string, def int64, valid []int64) int64 {
	v, ok, err := s.Setting(ctx, key)
	if err != nil || !ok {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || !slices.Contains(valid, n) {
		return def
	}
	return n
}

// HistoryLimits returns the retention settings (defaults: 1000 entries, 10 MB).
func (s *Store) HistoryLimits(ctx context.Context) HistoryLimits {
	return HistoryLimits{
		MaxEntries:       s.intSetting(ctx, SettingHistoryMaxEntries, DefaultHistoryMaxEntries, HistoryMaxEntriesChoices),
		MaxResponseBytes: s.intSetting(ctx, SettingHistoryMaxResponseBytes, DefaultHistoryMaxResponseBytes, HistoryMaxResponseBytesChoices),
	}
}

// SetHistoryMaxEntries stores the entry limit and prunes to it right away;
// it returns how many entries were deleted.
func (s *Store) SetHistoryMaxEntries(ctx context.Context, n int64) (int64, error) {
	if !slices.Contains(HistoryMaxEntriesChoices, n) {
		return 0, fmt.Errorf("history max entries must be one of %v", HistoryMaxEntriesChoices)
	}
	if err := s.PutSetting(ctx, SettingHistoryMaxEntries, strconv.FormatInt(n, 10)); err != nil {
		return 0, err
	}
	return s.pruneHistory(ctx, n)
}

// SetHistoryMaxResponseBytes stores the per-entry body cap (applies to new entries).
func (s *Store) SetHistoryMaxResponseBytes(ctx context.Context, n int64) error {
	if !slices.Contains(HistoryMaxResponseBytesChoices, n) {
		return fmt.Errorf("history max response size must be one of %v", HistoryMaxResponseBytesChoices)
	}
	return s.PutSetting(ctx, SettingHistoryMaxResponseBytes, strconv.FormatInt(n, 10))
}

// AddHistory inserts an entry and prunes to the entry limit.
func (s *Store) AddHistory(ctx context.Context, e InsertHistoryParams) (int64, error) {
	id, err := s.InsertHistory(ctx, e)
	if err != nil {
		return 0, err
	}
	if _, err := s.pruneHistory(ctx, s.HistoryLimits(ctx).MaxEntries); err != nil {
		return id, err
	}
	return id, nil
}

// pruneHistory keeps the newest max entries (0 = keep all) and gives freed pages back.
func (s *Store) pruneHistory(ctx context.Context, max int64) (int64, error) {
	if max <= 0 {
		return 0, nil
	}
	n, err := s.PruneHistory(ctx, max)
	if err != nil || n == 0 {
		return n, err
	}
	return n, s.ReclaimSpace(ctx)
}

// HistoryScope selects what ClearHistory deletes.
type HistoryScope string

const (
	ClearAll         HistoryScope = "all"
	ClearOlderThan30 HistoryScope = "older_than_30d"
	ClearProject     HistoryScope = "current_project"
)

// ClearHistory deletes entries (all, older than 30 days, or one project's) and
// frees the space on disk; it returns the number deleted.
func (s *Store) ClearHistory(ctx context.Context, scope HistoryScope, projectID string, now time.Time) (int64, error) {
	var n int64
	var err error
	switch scope {
	case ClearAll:
		n, err = s.DeleteAllHistory(ctx)
	case ClearOlderThan30:
		n, err = s.DeleteHistoryBefore(ctx, now.Add(-30*24*time.Hour).UnixMilli())
	case ClearProject:
		if projectID == "" {
			return 0, fmt.Errorf("no current project")
		}
		n, err = s.DeleteHistoryForProject(ctx, sql.NullString{String: projectID, Valid: true})
	default:
		return 0, fmt.Errorf("unknown history scope %q", scope)
	}
	if err != nil {
		return 0, err
	}
	return n, s.ReclaimSpace(ctx)
}

// ReclaimSpace returns free pages to the file system: incremental_vacuum frees
// them inside the database (auto_vacuum = INCREMENTAL, see migration 00007),
// and a TRUNCATE checkpoint moves that into the main file and empties the WAL —
// so the file on disk, and the storage indicator, actually shrink.
func (s *Store) ReclaimSpace(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `PRAGMA incremental_vacuum`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}

// StorageInfo is what the Settings modal shows.
type StorageInfo struct {
	Rows  int64
	Bytes int64 // the database's size on disk (history is nearly all of it)
}

func (s *Store) pragmaInt(ctx context.Context, name string) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx, "PRAGMA "+name).Scan(&n)
	return n, err
}

// HistoryStorage reports the entry count and the database size (pages in use
// plus free pages not yet returned; after ReclaimSpace that is the file size).
func (s *Store) HistoryStorage(ctx context.Context) (StorageInfo, error) {
	rows, err := s.CountHistory(ctx)
	if err != nil {
		return StorageInfo{}, err
	}
	pages, err := s.pragmaInt(ctx, "page_count")
	if err != nil {
		return StorageInfo{}, err
	}
	size, err := s.pragmaInt(ctx, "page_size")
	if err != nil {
		return StorageInfo{}, err
	}
	return StorageInfo{Rows: rows, Bytes: pages * size}, nil
}

// AutoVacuumMode is PRAGMA auto_vacuum (0 none, 1 full, 2 incremental).
func (s *Store) AutoVacuumMode(ctx context.Context) (int64, error) {
	return s.pragmaInt(ctx, "auto_vacuum")
}
