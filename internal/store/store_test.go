package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpenMigratesAndPersistsHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "ghostman.db")

	s, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for i := int64(1); i <= 3; i++ {
		err := s.InsertHistory(ctx, InsertHistoryParams{
			Method: "GET", Url: "https://example.com", Status: 200, DurationMs: i, CreatedAt: 1000 + i,
		})
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	// Reopening re-runs migrations (a no-op) and must keep the rows.
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s.Close()

	rows, err := s.ListHistory(ctx, 2)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 || rows[0].CreatedAt != 1003 || rows[1].CreatedAt != 1002 {
		t.Errorf("want newest-first limit 2, got %+v", rows)
	}
}
