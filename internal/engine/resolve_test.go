package engine

import (
	"reflect"
	"strings"
	"testing"
)

// The resolution spec as a table (see resolve.go). frontend/src/vars.test.ts has the
// matching token table for the highlighter.
func TestResolve(t *testing.T) {
	vars := map[string]string{
		"host":   "api.example.com",
		"Token":  "s3cr3t",
		"empty":  "",
		" a ":    "spaced", //nolint:gocritic // deliberate: keys are matched exactly, spaces included
		"nested": "{{host}}",
		"x":      "X",
	}
	tests := []struct {
		name       string
		in         string
		want       string
		unresolved []string
	}{
		{"no tokens: literal passthrough", "https://example.com/path?q=1", "https://example.com/path?q=1", nil},
		{"empty input", "", "", nil},
		{"exact match", "https://{{host}}/v1", "https://api.example.com/v1", nil},
		{"several tokens", "{{x}}-{{x}}-{{host}}", "X-X-api.example.com", nil},
		{"case-sensitive: token is not Token", "Bearer {{token}}", "Bearer {{token}}", []string{"token"}},
		{"case-sensitive match", "Bearer {{Token}}", "Bearer s3cr3t", nil},
		{"defined empty value resolves to empty", "a{{empty}}b", "ab", nil},
		{"no trimming: spaces are part of the key", "{{ a }}|{{a}}", "spaced|{{a}}", []string{"a"}},
		{"no recursion: value containing a token is inserted as-is", "{{nested}}", "{{host}}", nil},
		{"unresolved left literally, collected once in order", "{{b}}/{{a}}/{{b}}", "{{b}}/{{a}}/{{b}}", []string{"b", "a"}},
		{"mixed resolved and unresolved", "{{host}}/{{missing}}", "api.example.com/{{missing}}", []string{"missing"}},
		{"empty braces are literal", "{{}}", "{{}}", nil},
		{"unclosed is literal", "{{host", "{{host", nil},
		{"single braces are literal", "{host}", "{host}", nil},
		{"brace inside a key is not a token", "{{a{b}}", "{{a{b}}", nil},
		{"triple open brace still finds the inner token", "{{{x}}", "{X", nil},
		{"triple close brace", "{{x}}}", "X}", nil},
		{"adjacent tokens", "{{x}}{{x}}", "XX", nil},
		{"unicode around and in keys", "ключ={{x}}✓ {{ключ}}", "ключ=X✓ {{ключ}}", []string{"ключ"}},
		{"json body", `{"auth":"{{Token}}","n":{{x}}}`, `{"auth":"s3cr3t","n":X}`, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, unresolved := Resolve(tt.in, vars)
			if got != tt.want {
				t.Errorf("Resolve(%q) = %q, want %q", tt.in, got, tt.want)
			}
			if !reflect.DeepEqual(unresolved, tt.unresolved) {
				t.Errorf("unresolved = %q, want %q", unresolved, tt.unresolved)
			}
		})
	}
}

func TestResolveWithNoVariables(t *testing.T) {
	got, unresolved := Resolve("{{a}} and {{b}}", nil)
	if got != "{{a}} and {{b}}" || !reflect.DeepEqual(unresolved, []string{"a", "b"}) {
		t.Fatalf("got %q %q", got, unresolved)
	}
}

func TestFindTokensOffsets(t *testing.T) {
	s := "x{{a}}y{{bb}}"
	got := FindTokens(s)
	want := []Token{{Key: "a", Start: 1, End: 6}, {Key: "bb", Start: 7, End: 13}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
	for _, tok := range got {
		if s[tok.Start:tok.End] != "{{"+tok.Key+"}}" {
			t.Errorf("offsets wrong for %+v", tok)
		}
	}
}

func TestResolveSpec(t *testing.T) {
	vars := map[string]string{"base": "https://h.io", "k": "K", "v": "V"}
	spec := RequestSpec{
		Method: "POST",
		URL:    "{{base}}/p?x={{v}}",
		Headers: []Header{
			{Key: "X-{{k}}", Value: "{{v}}", Enabled: true},
			{Key: "X-Off", Value: "{{offOnly}}", Enabled: false},
			{Key: "Auth", Value: "{{token}}", Enabled: true},
		},
		QueryParams: []Header{{Key: "{{k}}", Value: "{{v}}-{{missingQ}}", Enabled: true}},
		Body:        Body{Type: BodyRaw, Content: `{"a":"{{v}}"}`, Fields: []Header{{Key: "{{notSent}}", Enabled: true}}},
	}
	out, unresolved := ResolveSpec(spec, vars)
	if out.URL != "https://h.io/p?x=V" {
		t.Errorf("url = %q", out.URL)
	}
	if out.Headers[0] != (Header{Key: "X-K", Value: "V", Enabled: true}) || out.Headers[1].Value != "{{offOnly}}" ||
		out.Headers[2].Value != "{{token}}" {
		t.Errorf("headers = %+v", out.Headers)
	}
	if out.QueryParams[0] != (Header{Key: "K", Value: "V-{{missingQ}}", Enabled: true}) {
		t.Errorf("params = %+v", out.QueryParams)
	}
	if out.Body.Content != `{"a":"V"}` || out.Body.Fields[0].Key != "{{notSent}}" {
		t.Errorf("body = %+v", out.Body)
	}
	// Disabled rows and the unused form fields of a raw body are not reported.
	if strings.Join(unresolved, ",") != "token,missingQ" {
		t.Errorf("unresolved = %q", unresolved)
	}
	if spec.Headers[0].Key != "X-{{k}}" {
		t.Error("input spec was mutated")
	}

	form := RequestSpec{URL: "u", Body: Body{Type: BodyForm, Content: "{{ignored}}",
		Fields: []Header{{Key: "{{k}}", Value: "{{v}}", Enabled: true}, {Key: "{{x}}", Enabled: false}}}}
	out, unresolved = ResolveSpec(form, vars)
	if out.Body.Fields[0] != (Header{Key: "K", Value: "V", Enabled: true}) || len(unresolved) != 0 {
		t.Errorf("form = %+v, unresolved %q", out.Body.Fields, unresolved)
	}
}
