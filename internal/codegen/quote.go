package codegen

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// Quoting per target: every value a snippet carries goes through one of these,
// and the tests run the snippets to prove the bytes arrive unchanged (', ", $,
// `, \, newlines, unicode).

// shQuote quotes s as ONE bash word. Single quotes keep everything literal ($, `,
// \, ", newlines); a single quote closes the quoting, is escaped, and reopens it.
// In one-line mode a value with a line break uses ANSI-C quoting ($'…', \n
// escapes) so the command stays on one line; that form is bash / zsh / Git Bash,
// not cmd.exe.
// A carriage return always takes $'…': Git Bash drops a CR at a line end inside
// single quotes.
func shQuote(s string, oneLine bool) string {
	if strings.Contains(s, "\r") || (oneLine && strings.Contains(s, "\n")) {
		return ansiCQuote(s)
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func ansiCQuote(s string) string {
	var b strings.Builder
	b.WriteString("$'")
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '\\':
			b.WriteString(`\\`)
		case c == '\'':
			b.WriteString(`\'`)
		case c == '\n':
			b.WriteString(`\n`)
		case c == '\r':
			b.WriteString(`\r`)
		case c == '\t':
			b.WriteString(`\t`)
		case c < 0x20 || c == 0x7f:
			fmt.Fprintf(&b, `\x%02x`, c)
		default:
			b.WriteByte(c) // UTF-8 bytes of non-ASCII text pass through as they are
		}
	}
	b.WriteString("'")
	return b.String()
}

// jsString is a JavaScript string literal (JSON's, HTML characters unescaped).
func jsString(s string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	out := strings.TrimSuffix(buf.String(), "\n")
	// Valid JSON, but escaped for older JS engines and editors alike.
	out = strings.ReplaceAll(out, " ", ` `)
	return strings.ReplaceAll(out, " ", ` `)
}

// pyString is a Python 3 string literal (double-quoted; unicode kept as is —
// Python source is UTF-8).
func pyString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '\\':
			b.WriteString(`\\`)
		case r == '"':
			b.WriteString(`\"`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20 || r == 0x7f:
			fmt.Fprintf(&b, `\x%02x`, r)
		case r == 0x2028 || r == 0x2029:
			fmt.Fprintf(&b, `\u%04x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// goString is a Go string literal.
func goString(s string) string { return strconv.Quote(s) }
