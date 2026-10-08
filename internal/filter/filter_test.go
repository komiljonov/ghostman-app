package filter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// analytics: 120 items, every 3rd with revenue > 1000.
func analytics(t *testing.T) *Doc {
	t.Helper()
	items := make([]map[string]any, 120)
	for i := range items {
		rev := 100 + i*5
		if i%3 == 0 {
			rev = 1500 + i
		}
		items[i] = map[string]any{"id": i, "name": fmt.Sprintf("item-%03d", i), "revenue": rev, "status": []string{"ok", "failed"}[i%2]}
	}
	b, _ := json.Marshal(map[string]any{"data": items, "meta": map[string]any{"total": 120, "big_id": json.Number("12345678901234567890")}})
	d, err := Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func eval(t *testing.T, d *Doc, q string) (Result, error) {
	t.Helper()
	return Eval(context.Background(), d, q)
}

func TestStreamIsCollectedIntoAnArray(t *testing.T) {
	r, err := eval(t, analytics(t), ".data[] | select(.revenue > 1000) | .id")
	if err != nil {
		t.Fatal(err)
	}
	var ids []int
	if json.Unmarshal(r.Full, &ids) != nil || len(ids) != 40 || ids[0] != 0 || ids[1] != 3 || r.Count != 40 || r.IsText {
		t.Fatalf("result = %q (count %d)", r.Text[:min(80, len(r.Text))], r.Count)
	}
	if !strings.HasPrefix(r.Note, "40 results · ") || !strings.Contains(r.Note, " of ") {
		t.Errorf("note = %q", r.Note)
	}
	if !strings.Contains(r.Text, "\n  ") {
		t.Error("result must be pretty-printed (indent 2)")
	}
}

func TestSingleValuesAndText(t *testing.T) {
	d := analytics(t)
	r, _ := eval(t, d, ".meta")
	if r.Count != 1 || r.IsText || !strings.Contains(r.Text, `"total": 120`) || r.Note[:8] != "1 result" {
		t.Errorf(".meta = %+v", r)
	}
	// Big integers are not rounded (json.Number).
	if !strings.Contains(r.Text, "12345678901234567890") {
		t.Errorf("big id rounded: %s", r.Text)
	}
	s, _ := eval(t, d, ".data[0].name")
	if !s.IsText || s.Text != "item-000" {
		t.Errorf("string result = %+v", s)
	}
	n, _ := eval(t, d, ".data | length")
	if n.IsText || strings.TrimSpace(n.Text) != "120" {
		t.Errorf("length = %q", n.Text)
	}
	none, _ := eval(t, d, `.data[] | select(.name == "nope")`)
	if none.Count != 0 || none.Note != "no matches" || none.Text != "" {
		t.Errorf("empty = %+v", none)
	}
	obj, _ := eval(t, d, ".data[0] | {id, name}")
	if !strings.Contains(obj.Text, `"id": 0`) || strings.Contains(obj.Text, "revenue") {
		t.Errorf("pick = %s", obj.Text)
	}
}

func TestErrors(t *testing.T) {
	d := analytics(t)
	for _, q := range []string{".data[] | select(.revenue >", ".data[", "nosuchfn(1)"} {
		if _, err := eval(t, d, q); err == nil || strings.HasPrefix(err.Error(), "gojq:") || strings.Contains(err.Error(), "\n") {
			t.Errorf("%q: err = %v", q, err)
		}
	}
	if _, err := eval(t, d, `.meta.total | ascii_downcase`); err == nil {
		t.Error("runtime error expected")
	}
	if _, err := Parse([]byte("<html>not json</html>")); !errors.Is(err, ErrNotJSON) {
		t.Errorf("html: %v", err)
	}
	if _, err := Parse([]byte(`{"a":1} {"b":2}`)); !errors.Is(err, ErrNotJSON) {
		t.Errorf("two documents: %v", err)
	}
}

func TestPathologicalQueryTimesOut(t *testing.T) {
	start := time.Now()
	_, err := eval(t, analytics(t), "last(range(1e15))")
	if err == nil || err.Error() != "filter timed out" {
		t.Fatalf("err = %v", err)
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Fatalf("took %v", took)
	}
}

func TestPreviewCapAndNote(t *testing.T) {
	big := make([]string, 30_000)
	for i := range big {
		big[i] = strings.Repeat("é", 10) // multi-byte: the cut must stay valid UTF-8
	}
	b, _ := json.Marshal(map[string]any{"rows": big})
	d, _ := Parse(b)
	r, err := eval(t, d, ".rows")
	if err != nil {
		t.Fatal(err)
	}
	if !r.Truncated || len(r.Text) > PreviewCap || len(r.Full) <= PreviewCap || !strings.Contains(r.Note, "showing the first 256.0 KB") {
		t.Fatalf("cap: truncated=%v text=%d full=%d note=%q", r.Truncated, len(r.Text), len(r.Full), r.Note)
	}
	// The cap holds for what the bridge carries: the JSON-encoded string.
	if enc, _ := json.Marshal(r.Text); len(enc) > PreviewCap || len(enc) < PreviewCap-8*1024 {
		t.Fatalf("encoded preview = %d bytes, want at most %d (and close to it)", len(enc), PreviewCap)
	}
	if !json.Valid(r.Full) || strings.ContainsRune(r.Text, '�') {
		t.Fatal("full must be valid JSON and the preview valid UTF-8")
	}
}

func TestFormatBytes(t *testing.T) {
	for n, want := range map[int]string{0: "0 B", 1023: "1023 B", 8294: "8.1 KB", 42_152_755: "40.2 MB"} {
		if got := FormatBytes(n); got != want {
			t.Errorf("%d = %q, want %q", n, got, want)
		}
	}
}
