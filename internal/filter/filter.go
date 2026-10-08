// Package filter runs jq queries (gojq) over JSON response bodies for display:
// the response pane's filter bar and the history detail. The body is parsed
// once (Parse) and the parsed document reused for every keystroke's query.
//
// Results: no output → "no matches"; one output → that value (a string is shown
// as plain text); several outputs (a stream such as .data[]) → collected into a
// JSON array. The display copy is pretty-printed and capped at PreviewCap bytes
// (the bridge discipline for response bodies); Full keeps the whole result for
// copy / save, Go-side only.
package filter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/itchyny/gojq"
)

const (
	// Timeout bounds one evaluation (a pathological query must not hang the UI).
	Timeout = time.Second
	// PreviewCap is the most a result sends to the UI (as response bodies do).
	PreviewCap = 256 * 1024
	// MaxOutputs bounds how many stream outputs are collected.
	MaxOutputs = 200_000
)

// ErrNotJSON is returned for a body that is not one JSON document.
var ErrNotJSON = errors.New("the response is not JSON")

// Doc is a parsed JSON body.
type Doc struct {
	value any
	size  int // the body's size in bytes, for the note
}

// Parse decodes a body into a document gojq can run on. Numbers stay
// json.Number, so big integer ids are not rounded.
func Parse(body []byte) (*Doc, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, ErrNotJSON
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, ErrNotJSON // trailing data: several documents or garbage
	}
	return &Doc{value: v, size: len(body)}, nil
}

// Result is one evaluation.
type Result struct {
	Text      string // the display copy: pretty JSON, or a string result as plain text (capped)
	IsText    bool   // a single string result, shown as text
	Count     int    // number of outputs
	Truncated bool   // Text was cut at PreviewCap
	Note      string // "12 results · 8.1 KB of 40.2 MB" / "no matches"
	Full      []byte // the whole result (not capped), for copy / save
}

// Eval compiles and runs query on doc. Errors are human messages (compile
// errors as gojq words them, "filter timed out", a jq runtime error).
func Eval(ctx context.Context, doc *Doc, query string) (Result, error) {
	q, err := gojq.Parse(strings.TrimSpace(query))
	if err != nil {
		return Result{}, errors.New(cleanErr(err))
	}
	code, err := gojq.Compile(q)
	if err != nil {
		return Result{}, errors.New(cleanErr(err))
	}
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()

	var outs []any
	iter := code.RunWithContext(ctx, doc.value)
	for {
		v, ok := iter.Next()
		if !ok {
			break
		}
		if e, isErr := v.(error); isErr {
			if errors.Is(e, context.DeadlineExceeded) || errors.Is(e, context.Canceled) {
				return Result{}, errors.New("filter timed out")
			}
			var halt *gojq.HaltError
			if errors.As(e, &halt) && halt.Value() == nil {
				break // halt: stop, keep what was produced
			}
			return Result{}, errors.New(cleanErr(e))
		}
		outs = append(outs, v)
		if len(outs) >= MaxOutputs {
			break
		}
	}
	return render(outs, doc.size), nil
}

func render(outs []any, bodySize int) Result {
	r := Result{Count: len(outs)}
	switch len(outs) {
	case 0:
		r.Note = "no matches"
		return r
	case 1:
		if s, ok := outs[0].(string); ok {
			r.IsText, r.Full = true, []byte(s)
			break
		}
		r.Full = pretty(outs[0])
	default:
		r.Full = pretty(outs)
	}
	r.Text, r.Truncated = capText(r.Full)
	r.Note = note(len(outs), len(r.Full), bodySize, r.Truncated)
	return r
}

// pretty is jq-style JSON (gojq.Marshal: keys sorted like jq, no HTML
// escaping) indented by 2.
func pretty(v any) []byte {
	compact, _ := gojq.Marshal(v)
	var out bytes.Buffer
	if err := json.Indent(&out, compact, "", "  "); err != nil {
		return compact
	}
	return out.Bytes()
}

// capText cuts the display copy so that it stays within PreviewCap as it
// crosses the bridge — i.e. JSON-encoded, where quotes, backslashes and
// newlines grow (pretty JSON: ~20%) — never inside a multi-byte character.
func capText(b []byte) (string, bool) {
	if encodedLen(b) <= PreviewCap {
		return string(b), false
	}
	n := min(len(b), PreviewCap)
	for {
		for n > 0 && n < len(b) && !utf8.RuneStart(b[n]) {
			n--
		}
		over := encodedLen(b[:n]) - PreviewCap
		if over <= 0 {
			return string(b[:n]), true
		}
		n -= over // each extra encoded byte comes from at least one source byte
	}
}

// encodedLen is the size of b as a JSON string (what the Wails bridge sends).
func encodedLen(b []byte) int {
	enc, _ := json.Marshal(string(b))
	return len(enc)
}

func note(count, resultSize, bodySize int, truncated bool) string {
	what := "1 result"
	if count != 1 {
		what = fmt.Sprintf("%d results", count)
	}
	if count >= MaxOutputs {
		what = fmt.Sprintf("first %d results", MaxOutputs)
	}
	s := fmt.Sprintf("%s · %s of %s", what, FormatBytes(resultSize), FormatBytes(bodySize))
	if truncated {
		s += fmt.Sprintf(" · showing the first %s", FormatBytes(PreviewCap))
	}
	return s
}

// FormatBytes: "512 B", "8.1 KB", "40.2 MB".
func FormatBytes(n int) string {
	switch {
	case n < 1024:
		return fmt.Sprintf("%d B", n)
	case n < 1024*1024:
		return fmt.Sprintf("%.1f KB", float64(n)/1024)
	default:
		return fmt.Sprintf("%.1f MB", float64(n)/(1024*1024))
	}
}

// cleanErr: gojq's message, first line, without a leading "gojq: ".
func cleanErr(err error) string {
	msg := strings.TrimPrefix(err.Error(), "gojq: ")
	if i := strings.IndexByte(msg, '\n'); i >= 0 {
		msg = msg[:i]
	}
	return msg
}
