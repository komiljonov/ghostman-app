package jsonfmt

import (
	"errors"
	"strings"
	"testing"
)

func TestMask(t *testing.T) {
	cases := []struct {
		name, in string
		masked   []string // the original tokens that got masked, in order
	}{
		{"value", `{"n":{{count}}}`, []string{"{{count}}"}},
		{"inside a string: untouched", `{"t":"{{TOKEN}}"}`, nil},
		{"array items", `[{{x}},2,{{y}}]`, []string{"{{x}}", "{{y}}"}},
		{"object key", `{{{k}}:1}`, []string{"{{k}}"}},
		{"escaped quote keeps the string open", `{"a":"x\"{{v}}","b":{{w}}}`, []string{"{{w}}"}},
		{"escaped backslash closes it", `{"a":"x\\","b":{{w}}}`, []string{"{{w}}"}},
		{"braces inside a string", `{"a":"a}}b","b":"{{","c":{{v}}}`, []string{"{{v}}"}},
		{"not a token: literal", `{"a":{{}}}`, nil},
		{"key with spaces is verbatim", `{"a":{{ a }}}`, []string{"{{ a }}"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			masked, masks := Mask(c.in)
			var got []string
			for _, m := range masks {
				got = append(got, m.orig)
				if !strings.Contains(masked, m.placeholder) {
					t.Fatalf("placeholder %s missing from %s", m.placeholder, masked)
				}
			}
			if strings.Join(got, "|") != strings.Join(c.masked, "|") {
				t.Fatalf("masked %q, want %q", got, c.masked)
			}
			if Restore(masked, masks) != c.in {
				t.Fatalf("restore: %q != %q", Restore(masked, masks), c.in)
			}
		})
	}
}

func TestPlaceholderNeverCollides(t *testing.T) {
	// The input already contains the first placeholder names, quoted, as real data.
	in := `{"a":"__gmvar0_0__","b":"__gmvar1_0__","c":{{v}}}`
	got, err := Format(in)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  \"a\": \"__gmvar0_0__\",\n  \"b\": \"__gmvar1_0__\",\n  \"c\": {{v}}\n}"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	// Placeholder 1 must not match inside placeholder 10.
	parts := make([]string, 12)
	for i := range parts {
		parts[i] = "{{v" + string(rune('a'+i)) + "}}"
	}
	in = "[" + strings.Join(parts, ",") + "]"
	got, err = Format(in)
	if err != nil {
		t.Fatal(err)
	}
	if want := "[\n  " + strings.Join(parts, ",\n  ") + "\n]"; got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestFormat(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"minified", `{"a":1,"b":[1,2],"c":{}}`, "{\n  \"a\": 1,\n  \"b\": [\n    1,\n    2\n  ],\n  \"c\": {}\n}"},
		{"template, in and out of strings", `{"a":{{n}},"b":"{{tok}}","c":[{{x}},2]}`,
			"{\n  \"a\": {{n}},\n  \"b\": \"{{tok}}\",\n  \"c\": [\n    {{x}},\n    2\n  ]\n}"},
		{"literals kept exactly", `{"big":12345678901234567890,"f":1.0,"e":"\u00e9","d":1,"d":2}`,
			"{\n  \"big\": 12345678901234567890,\n  \"f\": 1.0,\n  \"e\": \"\\u00e9\",\n  \"d\": 1,\n  \"d\": 2\n}"},
		{"trailing newline kept", "{\"a\":1}\n", "{\n  \"a\": 1\n}\n"},
		{"no trailing newline stays none", "  {\"a\":1}", "{\n  \"a\": 1\n}"},
		{"already formatted: idempotent", "{\n  \"a\": 1\n}", "{\n  \"a\": 1\n}"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Format(c.in)
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("got\n%s\nwant\n%s", got, c.want)
			}
		})
	}
}

func TestFormatErrors(t *testing.T) {
	cases := []struct {
		name, in  string
		line, col int
		msg       string
	}{
		{"ends early", `{"a":`, 1, 6, "unexpected end of JSON input"},
		{"bad char on line 2", "{\n  \"a\": x\n}", 2, 8, "invalid character 'x' looking for beginning of value"},
		{"position past masked tokens", `{"a":{{n}},"b":}`, 1, 16, "invalid character '}' looking for beginning of value"},
		{"counts characters, not bytes", `{"é":1 2}`, 1, 8, "invalid character '2' after object key:value pair"},
		{"unclosed token is literal", `{"a":{{n}`, 1, 7, "invalid character '{' looking for beginning of object key string"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Format(c.in)
			if got != c.in {
				t.Fatalf("text changed on error: %q", got)
			}
			var se *SyntaxError
			if !errors.As(err, &se) {
				t.Fatalf("want *SyntaxError, got %v", err)
			}
			if se.Line != c.line || se.Col != c.col || se.Msg != c.msg {
				t.Fatalf("got %q line %d col %d", se.Msg, se.Line, se.Col)
			}
		})
	}
	if _, err := Format(" \n "); !errors.Is(err, ErrEmpty) {
		t.Fatalf("empty: %v", err)
	}
}
