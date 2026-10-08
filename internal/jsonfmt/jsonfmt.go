// Package jsonfmt formats a raw JSON request body that may contain {{var}}
// template tokens (the raw body editor's Format action).
//
// A template body like {"n": {{count}}, "t": "{{TOKEN}}"} is not valid JSON:
// {{count}} sits outside a string. Format therefore works in three steps:
//
//  1. Mask: a scanner walks the text tracking string state (escapes included) and
//     replaces every {{key}} token OUTSIDE a string literal — values, array items
//     and object keys alike — with a JSON string placeholder. Tokens inside string
//     literals are valid JSON already and are left alone. A token is exactly what
//     engine.FindTokens accepts ("{{" + key without braces + "}}").
//  2. Indent with encoding/json's Indent (2 spaces). Indent re-indents without
//     decoding values, so number literals (1.0, big integers), key order,
//     duplicate keys and string escapes all stay exactly as written.
//  3. Restore each placeholder to its original token text, byte for byte.
//
// Placeholder choice: the JSON string "__gmvar<salt>_<n>__", where <salt> is the
// smallest number for which "__gmvar<salt>_" occurs nowhere in the input. Every
// occurrence in the output is then ours (no collision with real content), it
// survives Indent unchanged (strings are copied verbatim), and the "__" after <n>
// keeps placeholder 1 from matching inside placeholder 10.
//
// Leading whitespace is dropped (as Indent does); the input's trailing whitespace
// (its trailing-newline state) is kept as it was.
package jsonfmt

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"ghostman/internal/engine"
)

// SyntaxError is a parse failure, positioned in the ORIGINAL text (1-based; the
// column counts characters, not bytes).
type SyntaxError struct {
	Msg       string
	Line, Col int
}

func (e *SyntaxError) Error() string {
	// Position first: the UI hint truncates at its end in a narrow pane.
	return fmt.Sprintf("line %d, col %d: %s", e.Line, e.Col, e.Msg)
}

// ErrEmpty: nothing to format.
var ErrEmpty = errors.New("the body is empty")

// mask is one replaced token: where it sits in the masked text and the original.
type mask struct {
	maskedStart, maskedLen int
	origStart              int
	orig                   string
	placeholder            string // including the quotes
}

// Mask replaces the {{tokens}} outside string literals with placeholders and
// returns the masked text plus what was replaced (in order).
func Mask(s string) (string, []mask) {
	prefix := placeholderPrefix(s)
	var b strings.Builder
	var masks []mask
	inString, escaped := false, false
	for i := 0; i < len(s); {
		c := s[i]
		if inString {
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			}
			b.WriteByte(c)
			i++
			continue
		}
		if c == '"' {
			inString = true
			b.WriteByte(c)
			i++
			continue
		}
		if c == '{' {
			if end := tokenEnd(s, i); end > 0 {
				ph := `"` + prefix + strconv.Itoa(len(masks)) + `__"`
				masks = append(masks, mask{maskedStart: b.Len(), maskedLen: len(ph), origStart: i, orig: s[i:end], placeholder: ph})
				b.WriteString(ph)
				i = end
				continue
			}
		}
		b.WriteByte(c)
		i++
	}
	return b.String(), masks
}

// tokenEnd: the end offset of the {{key}} token starting at i, or 0 if none
// starts there (the same grammar as engine.FindTokens).
func tokenEnd(s string, i int) int {
	toks := engine.FindTokens(s[i:])
	if len(toks) == 0 || toks[0].Start != 0 {
		return 0
	}
	return i + toks[0].End
}

func placeholderPrefix(s string) string {
	for salt := 0; ; salt++ {
		p := "__gmvar" + strconv.Itoa(salt) + "_"
		if !strings.Contains(s, p) {
			return p
		}
	}
}

// Restore puts every token back verbatim.
func Restore(s string, masks []mask) string {
	for _, m := range masks {
		s = strings.Replace(s, m.placeholder, m.orig, 1)
	}
	return s
}

// Format pretty-prints s (2-space indent), keeping {{tokens}} verbatim. On a
// syntax error it returns a *SyntaxError and the caller changes nothing.
func Format(s string) (string, error) {
	core := strings.TrimRight(s, " \t\r\n")
	trailing := s[len(core):]
	if strings.TrimSpace(core) == "" {
		return s, ErrEmpty
	}
	masked, masks := Mask(core)
	var out bytes.Buffer
	if err := json.Indent(&out, []byte(masked), "", "  "); err != nil {
		var se *json.SyntaxError
		if errors.As(err, &se) {
			return s, positioned(core, masks, int(se.Offset), se.Error())
		}
		return s, &SyntaxError{Msg: err.Error(), Line: 1, Col: 1}
	}
	return Restore(out.String(), masks) + trailing, nil
}

// positioned maps a byte offset in the masked text back to the original and
// turns it into line/column. encoding/json reports the offset just past the
// offending byte, so the position points at that byte.
func positioned(orig string, masks []mask, maskedOff int, msg string) *SyntaxError {
	off := maskedOff - 1
	if strings.Contains(msg, "unexpected end") {
		off = maskedOff // the input ran out: point just past its end
	}
	if off < 0 {
		off = 0
	}
	off = origOffset(masks, off)
	if off > len(orig) {
		off = len(orig)
	}
	before := orig[:off]
	line := strings.Count(before, "\n") + 1
	col := utf8.RuneCountInString(before[strings.LastIndexByte(before, '\n')+1:]) + 1
	return &SyntaxError{Msg: strings.TrimPrefix(msg, "json: "), Line: line, Col: col}
}

// origOffset maps a masked-text offset to the original text: a placeholder's
// bytes map to its token's start, everything else shifts by the size difference
// of the placeholders before it.
func origOffset(masks []mask, off int) int {
	shift := 0
	for _, m := range masks {
		if off < m.maskedStart {
			break
		}
		if off < m.maskedStart+m.maskedLen {
			return m.origStart
		}
		shift += m.maskedLen - len(m.orig)
	}
	return off - shift
}
