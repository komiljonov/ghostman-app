// Package pathsweep rewrites URLs left over from the retired path variables
// (Postman-style ":id" segments with values in synced path_params rows). The
// server has dropped those rows; {{variables}} are the one variable system now.
//
// Rule, per URL path segment (the text before "?" split on "/") that is exactly
// ":" + [A-Za-z_][A-Za-z0-9_]*:
//   - its row's value when that is non-empty — ":id" with "{{product_id}}" becomes
//     "{{product_id}}", with "123" becomes "123";
//   - else "{{key}}" (no row, or an empty value).
//
// A rewritten URL has no such segments left, so the sweep is idempotent.
package pathsweep

import (
	"regexp"
	"strings"
)

var keyRe = regexp.MustCompile(`^:[A-Za-z_][A-Za-z0-9_]*$`)

// Rewrite returns the URL with every ":key" path segment replaced, and whether
// anything changed. values = the cached row values by key (may be nil).
func Rewrite(u string, values map[string]string) (string, bool) {
	path, rest := u, ""
	if i := strings.IndexByte(u, '?'); i >= 0 {
		path, rest = u[:i], u[i:]
	}
	segs := strings.Split(path, "/")
	changed := false
	for i, seg := range segs {
		if !keyRe.MatchString(seg) {
			continue
		}
		key := seg[1:]
		if v := values[key]; v != "" {
			segs[i] = v
		} else {
			segs[i] = "{{" + key + "}}"
		}
		changed = true
	}
	if !changed {
		return u, false
	}
	return strings.Join(segs, "/") + rest, true
}
