package engine

import (
	"net/url"
	"regexp"
	"strings"
)

// Path variables (Postman-style ":id"). frontend/src/urlParams.ts derives the
// same keys for the Params tab (keep both test tables in step).
//
//   - The URL text before the first "?" is split on "/"; a segment that is
//     exactly ":" + [A-Za-z_][A-Za-z0-9_]* is a path variable (":id", ":user_id";
//     not ":", ":1d", ":id.json", "host:8080").
//   - At send time — after {{vars}} are resolved in the URL and in the values —
//     every such segment is replaced by url.PathEscape(value). The value is ONE
//     segment: a "/" in it is sent as %2F (as are "?", "#", " "…), never as a new
//     path level.
//   - A key with an empty value (or no row) is sent literally (":id") and
//     reported as unresolved as ":id".

// PathParam is one path variable's value (the server's {key, value} row).
type PathParam struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

var pathKeyRe = regexp.MustCompile(`^:[A-Za-z_][A-Za-z0-9_]*$`)

// pathPart splits a URL into the part path variables live in (before "?") and
// the rest.
func pathPart(u string) (string, string) {
	if i := strings.IndexByte(u, '?'); i >= 0 {
		return u[:i], u[i:]
	}
	return u, ""
}

// PathVarKeys returns the path variable keys of a URL (without ":"), in order
// of first appearance, without duplicates.
func PathVarKeys(u string) []string {
	path, _ := pathPart(u)
	var out []string
	seen := map[string]bool{}
	for _, seg := range strings.Split(path, "/") {
		if pathKeyRe.MatchString(seg) && !seen[seg[1:]] {
			seen[seg[1:]] = true
			out = append(out, seg[1:])
		}
	}
	return out
}

func hasPathVars(u string) bool { return len(PathVarKeys(u)) > 0 }

// SubstitutePath replaces the URL's :key segments by their escaped values and
// returns the URL plus the keys sent literally (as ":key") because their value
// is empty or missing.
func SubstitutePath(u string, values map[string]string) (string, []string) {
	path, rest := pathPart(u)
	segs := strings.Split(path, "/")
	var empty []string
	seen := map[string]bool{}
	for i, seg := range segs {
		if !pathKeyRe.MatchString(seg) {
			continue
		}
		if v := values[seg[1:]]; v != "" {
			segs[i] = url.PathEscape(v)
		} else if !seen[seg] {
			seen[seg] = true
			empty = append(empty, seg)
		}
	}
	return strings.Join(segs, "/") + rest, empty
}
