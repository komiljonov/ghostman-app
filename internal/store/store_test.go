package store

import (
	"context"
	"database/sql"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pressly/goose/v3"
)

func TestOpenMigratesAndPersistsHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "ghostman.db")

	s, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for i := int64(1); i <= 3; i++ {
		if _, err := s.AddHistory(ctx, InsertHistoryParams{
			Method: "GET", UrlTemplate: "https://example.com", Status: 200, DurationMs: i, CreatedAt: 1000 + i,
		}); err != nil {
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

	rows, err := s.ListHistoryPage(ctx, ListHistoryPageParams{PageLimit: 2})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 || rows[0].CreatedAt != 1003 || rows[1].CreatedAt != 1002 {
		t.Errorf("want newest-first limit 2, got %+v", rows)
	}
	if mode, err := s.AutoVacuumMode(ctx); err != nil || mode != 2 {
		t.Errorf("auto_vacuum = %d %v, want 2 (incremental)", mode, err)
	}
}

// A database from before migration 00006 (old history table, no auto_vacuum)
// keeps its rows (url -> url_template) and is converted to incremental vacuum.
func TestOldHistoryTableIsMigrated(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "old.db")
	old, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	fsys, _ := fs.Sub(migrations, "migrations")
	provider, err := goose.NewProvider(goose.DialectSQLite3, old, fsys)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 5); err != nil {
		t.Fatal(err)
	}
	if _, err := old.ExecContext(ctx, `INSERT INTO history (method, url, status, duration_ms, created_at)
		VALUES ('GET', 'https://a.io/x', 200, 12, 5000), ('POST', '{{B}}/y', 0, 3, 6000)`); err != nil {
		t.Fatal(err)
	}
	var mode int
	if err := old.QueryRowContext(ctx, "PRAGMA auto_vacuum").Scan(&mode); err != nil || mode != 0 {
		t.Fatalf("precondition: old db auto_vacuum = %d %v", mode, err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}

	s, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	defer s.Close()
	rows, err := s.ListHistoryPage(ctx, ListHistoryPageParams{PageLimit: 10})
	if err != nil || len(rows) != 2 {
		t.Fatalf("rows = %+v %v", rows, err)
	}
	if rows[0].Method != http.MethodPost || rows[0].UrlTemplate != "{{B}}/y" || rows[1].UrlTemplate != "https://a.io/x" ||
		rows[1].Status != 200 || rows[1].DurationMs != 12 || rows[1].ProjectID.Valid || rows[1].RespBodySize != 0 {
		t.Errorf("migrated rows = %+v", rows)
	}
	full, err := s.GetHistoryEntry(ctx, rows[1].ID)
	if err != nil || full.RespBody != nil || full.ReqHeadersJson.Valid || full.TimingsJson.Valid {
		t.Errorf("new columns must be empty: %+v %v", full, err)
	}
	if mode, err := s.AutoVacuumMode(ctx); err != nil || mode != 2 {
		t.Errorf("auto_vacuum = %d %v, want 2", mode, err)
	}
}

// Deleting history gives the space back: the FILE on disk shrinks.
func TestClearHistoryShrinksTheFile(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "big.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	body := make([]byte, 1<<20)
	for i := range 8 {
		if _, err := s.AddHistory(ctx, InsertHistoryParams{
			Method: "GET", UrlTemplate: "u", CreatedAt: int64(i), RespBody: body, RespBodySize: int64(len(body)),
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.ReclaimSpace(ctx); err != nil { // checkpoint the WAL into the file
		t.Fatal(err)
	}
	before := fileSize(t, path)
	if before < 8<<20 {
		t.Fatalf("file = %d bytes before clearing", before)
	}
	n, err := s.ClearHistory(ctx, ClearAll, "", time.Now())
	if err != nil || n != 8 {
		t.Fatalf("clear = %d %v", n, err)
	}
	after := fileSize(t, path)
	if after > 1<<20 {
		t.Fatalf("file = %d bytes after clearing (was %d)", after, before)
	}
	info, err := s.HistoryStorage(ctx)
	if err != nil || info.Rows != 0 || info.Bytes > 1<<20 {
		t.Fatalf("storage = %+v %v", info, err)
	}
}

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	var total int64
	for _, p := range []string{path, path + "-wal"} {
		if st, err := os.Stat(p); err == nil {
			total += st.Size()
		}
	}
	return total
}

func TestHistoryPruneScopesAndLimits(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "p.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.UnixMilli(100 * 24 * 3600 * 1000)
	day := int64(24 * 3600 * 1000)
	add := func(created int64, project string) {
		t.Helper()
		if _, err := s.AddHistory(ctx, InsertHistoryParams{
			Method: "GET", UrlTemplate: "u", CreatedAt: created,
			ProjectID: sql.NullString{String: project, Valid: project != ""},
		}); err != nil {
			t.Fatal(err)
		}
	}
	add(now.UnixMilli()-40*day, "p1")
	add(now.UnixMilli()-31*day, "p2")
	add(now.UnixMilli()-29*day, "p1")
	add(now.UnixMilli()-1*day, "p2")
	add(now.UnixMilli(), "")

	if l := s.HistoryLimits(ctx); l.MaxEntries != 1000 || l.MaxResponseBytes != 10<<20 {
		t.Fatalf("defaults = %+v", l)
	}
	if n, err := s.ClearHistory(ctx, ClearOlderThan30, "", now); err != nil || n != 2 {
		t.Fatalf("older than 30d = %d %v", n, err)
	}
	if n, err := s.ClearHistory(ctx, ClearProject, "p2", now); err != nil || n != 1 {
		t.Fatalf("project = %d %v", n, err)
	}
	// Lowering the limit prunes the oldest right away; 0 never prunes.
	if n, err := s.SetHistoryMaxEntries(ctx, 0); err != nil || n != 0 {
		t.Fatalf("unlimited = %d %v", n, err)
	}
	for i := range 120 {
		add(now.UnixMilli()+int64(i+1), "p1")
	}
	if n, err := s.SetHistoryMaxEntries(ctx, 100); err != nil || n != 22 {
		t.Fatalf("lower to 100 = %d %v", n, err)
	}
	if c, _ := s.CountHistory(ctx); c != 100 {
		t.Fatalf("count = %d", c)
	}
	add(now.UnixMilli()+1000, "p1") // auto-prune after insert
	if c, _ := s.CountHistory(ctx); c != 100 {
		t.Fatalf("count after insert = %d", c)
	}
	// A bad stored value falls back to the default.
	if err := s.PutSetting(ctx, SettingHistoryMaxEntries, "77"); err != nil {
		t.Fatal(err)
	}
	if l := s.HistoryLimits(ctx); l.MaxEntries != DefaultHistoryMaxEntries {
		t.Fatalf("invalid stored limit = %+v", l)
	}
}

func TestSettingsRoundtrip(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "ghostman.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}

	if _, ok, err := s.Setting(ctx, SettingSessionToken); ok || err != nil {
		t.Fatalf("missing key: ok=%v err=%v", ok, err)
	}
	for _, v := range []string{"first", "second"} { // second write must upsert
		if err := s.PutSetting(ctx, SettingSessionToken, v); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.PutSetting(ctx, SettingServerURL, "http://localhost:9999"); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()

	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if v, ok, err := s.Setting(ctx, SettingSessionToken); v != "second" || !ok || err != nil {
		t.Fatalf("token after reopen = %q ok=%v err=%v", v, ok, err)
	}
	if err := s.DeleteSetting(ctx, SettingSessionToken); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.Setting(ctx, SettingSessionToken); ok {
		t.Fatal("token still present after delete")
	}
	if v, _, _ := s.Setting(ctx, SettingServerURL); v != "http://localhost:9999" {
		t.Fatalf("server_url = %q", v)
	}
}

func TestFollowRedirectsGlobalDefault(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "ghostman.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if def, err := s.FollowRedirectsDefault(ctx); err != nil || !def {
		t.Fatalf("default: %v %v, want true", def, err)
	}
	if err := s.SetFollowRedirectsDefault(ctx, false); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if def, _ := s.FollowRedirectsDefault(ctx); def {
		t.Fatal("must stay off after reopen")
	}
	_ = s.PutSetting(ctx, settingFollowRedirectsDefault, "garbage")
	if def, _ := s.FollowRedirectsDefault(ctx); !def {
		t.Fatal("a corrupt value falls back to true")
	}
}

func TestLegacyRequestSettingsLifecycle(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "ghostman.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for id, v := range map[string]int64{"a": 0, "b": 1} {
		if err := s.PutFollowRedirects(ctx, PutFollowRedirectsParams{RequestID: id, FollowRedirects: v}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.LegacyRequestSettings(ctx)
	if err != nil || len(rows) != 2 || rows[0] != (LegacyRequestSetting{RequestID: "a", Follow: false}) || !rows[1].Follow {
		t.Fatalf("rows = %+v %v", rows, err)
	}
	if err := s.DropLegacyRequestSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if rows, err := s.LegacyRequestSettings(ctx); err != nil || rows != nil {
		t.Fatalf("after drop: %+v %v (no table = nothing to push)", rows, err)
	}
	if err := s.DropLegacyRequestSettings(ctx); err != nil {
		t.Fatal("dropping twice is fine")
	}
}
