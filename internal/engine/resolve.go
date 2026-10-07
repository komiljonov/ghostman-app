package engine

import "strings"

// Variable resolution — THE single source of truth for {{var}} semantics.
// (frontend/src/vars.ts mirrors the token grammar for highlighting only; keep the
// two in sync and keep both test tables passing.)
//
//  1. A token is "{{" + key + "}}", where key is one or more characters containing
//     no "{" and no "}". Tokens are found left to right and never overlap.
//  2. The key is matched exactly: case-sensitive, no trimming ("{{ a }}" is the key " a ").
//  3. A token whose key is in the map is replaced by the value (which may be empty).
//  4. A token whose key is not in the map is left in place, literally, and reported
//     as unresolved.
//  5. No recursion: a value that itself contains "{{other}}" is inserted as-is and
//     not resolved again.
//  6. Text that is not a complete token ("{{", "{{}}", "{{a", "{{a{b}}") is literal.

// Token is one {{key}} occurrence: Start and End are byte offsets of the whole
// token in the input (End exclusive).
type Token struct {
	Key        string
	Start, End int
}

// FindTokens returns every {{key}} token in s, left to right.
func FindTokens(s string) []Token {
	var out []Token
	i := 0
	for {
		open := strings.Index(s[i:], "{{")
		if open < 0 {
			return out
		}
		start := i + open
		keyStart := start + 2
		// The key runs until the next brace; it must be non-empty and end with "}}".
		k := keyStart
		for k < len(s) && s[k] != '{' && s[k] != '}' {
			k++
		}
		if k > keyStart && strings.HasPrefix(s[k:], "}}") {
			out = append(out, Token{Key: s[keyStart:k], Start: start, End: k + 2})
			i = k + 2
			continue
		}
		// Not a token: move on by one so "{{{a}}" still finds "{{a}}".
		i = start + 1
	}
}

// Resolve replaces the tokens of s found in vars and returns the result plus the
// keys left unresolved (in order of first appearance, without duplicates).
func Resolve(s string, vars map[string]string) (string, []string) {
	tokens := FindTokens(s)
	if len(tokens) == 0 {
		return s, nil
	}
	var b strings.Builder
	var unresolved []string
	seen := map[string]bool{}
	last := 0
	for _, t := range tokens {
		b.WriteString(s[last:t.Start])
		if v, ok := vars[t.Key]; ok {
			b.WriteString(v)
		} else {
			b.WriteString(s[t.Start:t.End])
			if !seen[t.Key] {
				seen[t.Key] = true
				unresolved = append(unresolved, t.Key)
			}
		}
		last = t.End
	}
	b.WriteString(s[last:])
	return b.String(), unresolved
}

// ResolveSpec resolves every part of a request that is sent: the URL, enabled
// header and query-param keys/values, a raw body's content and enabled form field
// keys/values, and the auth config's values. Disabled rows are not sent, so they are left as they are and their
// tokens are not reported. Unresolved keys are collected across all parts.
func ResolveSpec(spec RequestSpec, vars map[string]string) (RequestSpec, []string) {
	var all []string
	seen := map[string]bool{}
	res := func(s string) string {
		out, missing := Resolve(s, vars)
		for _, k := range missing {
			if !seen[k] {
				seen[k] = true
				all = append(all, k)
			}
		}
		return out
	}
	rows := func(in []Header) []Header {
		out := make([]Header, len(in))
		for i, r := range in {
			if r.Enabled {
				r.Key, r.Value = res(r.Key), res(r.Value)
			}
			out[i] = r
		}
		return out
	}

	out := spec
	out.URL = res(spec.URL)
	out.Headers = rows(spec.Headers)
	out.QueryParams = rows(spec.QueryParams)
	switch spec.Body.Type {
	case BodyRaw:
		out.Body.Content = res(spec.Body.Content)
	case BodyForm:
		out.Body.Fields = rows(spec.Body.Fields)
	}
	if spec.Auth != nil { // {{vars}} inside auth values, same map (auth.go)
		a := resolveAuth(*spec.Auth, res)
		out.Auth = &a
	}
	return out, all
}
