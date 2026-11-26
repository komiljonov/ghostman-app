package importer

import (
	"regexp"
	"strings"

	"github.com/dop251/goja"
)

// Postman script → gm script (internal/scripting), conservative and line-based.
//
//   - Mechanical renames only, for calls whose meaning is the same:
//     pm.environment / pm.collectionVariables / pm.globals / pm.variables
//     .get / .set / .unset → gm.environment.* (Ghostman has ONE variable scope,
//     the active environment; a header note says so when another scope was
//     renamed), pm.environment.name; pm.response.json() / .text() / .code →
//     .status / .responseTime → .durationMs / .headers.get(; pm.request.headers
//     .get / .remove / .add({key, value}) / .upsert({key, value}) (→ set),
//     pm.request.method, pm.request.url.toString(); CryptoJS.HmacSHA256 / HmacSHA1
//     / HmacSHA512 / SHA256 / MD5(…).toString() (or .toString(CryptoJS.enc.Hex))
//     → gm.crypto.* (hex). console.* stays as it is.
//   - Any line still using a Postman-only API afterwards (pm.test, pm.expect,
//     pm.sendRequest, postman.*, CryptoJS other forms, tests[…], responseBody …)
//     is kept as "// [postman] <line>", and so is every line of a block that line
//     opens (until its brackets close), so the rest still parses. In doubt →
//     comment. A header comment explains the markers.
//   - Safety net: if the result does not parse as JavaScript, EVERY line is kept
//     commented (a script that fails to compile would abort each send).

// PostmanMarker prefixes a kept Postman line.
const PostmanMarker = "// [postman] "

const (
	headerMarkers = "// Imported from Postman. Lines marked [postman] use APIs Ghostman's gm doesn't have — rewrite them with gm.* (see ?) or delete them."
	headerScope   = "// Imported from Postman: collection / global variables now read and write the active environment (Ghostman has one variable scope)."
	headerUnsafe  = "// Imported from Postman: this script could not be translated safely, so every line is kept as a comment."
)

// ScriptTranslation is a translated script and what happened to its lines.
type ScriptTranslation struct {
	Text       string
	Translated int // lines changed by the renames
	Commented  int // lines kept as [postman] comments
}

// postmanOnly finds a Postman API left on a line after the renames.
var postmanOnly = regexp.MustCompile(`\bpm\s*\.|\bpm\s*\[|\bpostman\s*\.|\bCryptoJS\b|\btests\s*\[|\bresponseBody\b|\bresponseCode\b|` +
	`\bresponseHeaders\b|\bresponseTime\b|\bxml2Json\b|\brequire\s*\(|\b_\s*\.`)

var renames = []struct {
	re  *regexp.Regexp
	to  string
	tag string // "scope" = another variable scope was mapped onto the environment
}{
	{regexp.MustCompile(`\bpm\.environment\.(get|set|unset)\s*\(`), "gm.environment.$1(", ""},
	{regexp.MustCompile(`\bpm\.(?:collectionVariables|globals|variables)\.(get|set|unset)\s*\(`), "gm.environment.$1(", "scope"},
	{regexp.MustCompile(`\bpm\.environment\.name\b`), "gm.environment.name", ""},
	{regexp.MustCompile(`\bpm\.response\.json\s*\(\s*\)`), "gm.response.json()", ""},
	{regexp.MustCompile(`\bpm\.response\.text\s*\(\s*\)`), "gm.response.text()", ""},
	{regexp.MustCompile(`\bpm\.response\.code\b`), "gm.response.status", ""},
	{regexp.MustCompile(`\bpm\.response\.responseTime\b`), "gm.response.durationMs", ""},
	{regexp.MustCompile(`\bpm\.response\.headers\.get\s*\(`), "gm.response.headers.get(", ""},
	{regexp.MustCompile(`\bpm\.request\.headers\.(get|remove)\s*\(`), "gm.request.headers.$1(", ""},
	{regexp.MustCompile(`\bpm\.request\.method\b`), "gm.request.method", ""},
	{regexp.MustCompile(`\bpm\.request\.url\.toString\s*\(\s*\)`), "gm.request.url", ""},
}

var cryptoCall = regexp.MustCompile(`\bCryptoJS\.(HmacSHA256|HmacSHA1|HmacSHA512|SHA256|MD5)\s*\(`)
var cryptoName = map[string]string{"HmacSHA256": "hmacSHA256", "HmacSHA1": "hmacSHA1", "HmacSHA512": "hmacSHA512", "SHA256": "sha256", "MD5": "md5"}
var hexToString = regexp.MustCompile(`^\s*\.toString\s*\(\s*(?:CryptoJS\.enc\.Hex)?\s*\)`)

var headerObj = regexp.MustCompile(`\bpm\.request\.headers\.(add|upsert)\s*\(`)
var keyValueArg = regexp.MustCompile(`^\{\s*key\s*:\s*("[^"\\]*"|'[^'\\]*')\s*,\s*value\s*:\s*(.+?)\s*,?\s*\}$`)

// TranslateScript translates one Postman script.
func TranslateScript(src string) ScriptTranslation {
	lines := strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines)+2)
	var res ScriptTranslation
	scope := false
	depth := 0     // > 0: inside a block a commented line opened
	lastCode := "" // the last kept code line (not blank)
	for _, line := range lines {
		if depth > 0 {
			out = append(out, commentLine(line))
			res.Commented++
			depth += bracketBalance(line)
			continue
		}
		next, scoped := translateLine(line)
		if postmanOnly.MatchString(stripStringsAndComments(next)) {
			// Commenting out part of an expression would silently change what
			// the rest means ("const x =" + a commented "pm.info.x;" + the next
			// line): such a script is kept commented as a whole.
			b := bracketBalance(line)
			if b < 0 || continues(lastCode) || startsContinuation(line) {
				return unsafeTranslation(lines)
			}
			out = append(out, commentLine(line))
			res.Commented++
			if b > 0 {
				depth = b
			}
			continue
		}
		if next != line {
			res.Translated++
			scope = scope || scoped
		}
		out = append(out, next)
		if strings.TrimSpace(next) != "" {
			lastCode = next
		}
	}
	var head []string
	if res.Commented > 0 {
		head = append(head, headerMarkers)
	}
	if scope {
		head = append(head, headerScope)
	}
	res.Text = strings.Join(append(head, out...), "\n")
	if _, err := goja.Compile("import", res.Text, false); err != nil {
		return unsafeTranslation(lines)
	}
	return res
}

func unsafeTranslation(lines []string) ScriptTranslation {
	out := []string{headerUnsafe}
	n := 0
	for _, l := range lines {
		out = append(out, commentLine(l))
		n++
	}
	return ScriptTranslation{Text: strings.Join(out, "\n"), Commented: n}
}

func commentLine(l string) string {
	if strings.TrimSpace(l) == "" {
		return l
	}
	return PostmanMarker + l
}

// translateLine applies the renames; scoped = a collection / global variable
// call became an environment call.
func translateLine(line string) (string, bool) {
	scoped := false
	for _, r := range renames {
		if r.re.MatchString(line) {
			line = r.re.ReplaceAllString(line, r.to)
			scoped = scoped || r.tag == "scope"
		}
	}
	line = rewriteCalls(line, headerObj, func(name, args, after string) (string, string, bool) {
		m := keyValueArg.FindStringSubmatch(strings.TrimSpace(args))
		if m == nil {
			return "", "", false
		}
		method := "add"
		if name == "upsert" {
			method = "set"
		}
		return "gm.request.headers." + method + "(" + m[1] + ", " + m[2] + ")", after, true
	})
	line = rewriteCalls(line, cryptoCall, func(name, args, after string) (string, string, bool) {
		m := hexToString.FindString(after)
		if m == "" {
			return "", "", false // another encoding (Base64 …): not the same value
		}
		return "gm.crypto." + cryptoName[name] + "(" + args + ")", after[len(m):], true
	})
	return line, scoped
}

// rewriteCalls replaces each call matched by re (group 1 = the name, the match
// ends at "(") whose arguments close on this line; fn gets the name, the
// argument text and the text after ")", and returns the replacement plus the
// remaining text (it may consume a suffix such as .toString()).
func rewriteCalls(line string, re *regexp.Regexp, fn func(name, args, after string) (string, string, bool)) string {
	from := 0
	for {
		loc := re.FindStringSubmatchIndex(line[from:])
		if loc == nil {
			return line
		}
		start, open := from+loc[0], from+loc[1]-1
		name := line[from+loc[2] : from+loc[3]]
		end := closingParen(line, open)
		if end < 0 {
			from = open + 1
			continue
		}
		rep, rest, ok := fn(name, line[open+1:end], line[end+1:])
		if !ok {
			from = open + 1
			continue
		}
		line = line[:start] + rep + rest
		from = start + len(rep)
	}
}

// stringEnd returns the index of the quote closing the string literal that
// starts at i (len(s) when it does not close on this line).
func stringEnd(s string, i int) int {
	q := s[i]
	for j := i + 1; j < len(s); j++ {
		switch s[j] {
		case '\\':
			j++
		case q:
			return j
		}
	}
	return len(s)
}

func isQuote(c byte) bool { return c == '"' || c == '\'' || c == '`' }

// closingParen returns the index of the ")" matching the "(" at open, skipping
// strings; -1 when it does not close on this line.
func closingParen(s string, open int) int {
	depth := 0
	for i := open; i < len(s); i++ {
		switch c := s[i]; {
		case isQuote(c):
			i = stringEnd(s, i)
		case c == '(':
			depth++
		case c == ')':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

// bracketBalance counts ( [ { minus ) ] } outside strings and // comments.
func bracketBalance(s string) int {
	n := 0
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case isQuote(c):
			i = stringEnd(s, i)
		case c == '/' && i+1 < len(s) && s[i+1] == '/':
			return n
		case c == '(' || c == '[' || c == '{':
			n++
		case c == ')' || c == ']' || c == '}':
			n--
		}
	}
	return n
}

// stripStringsAndComments blanks string literals (the quotes stay) and drops a
// trailing // comment, so "pm." inside a message or a comment is not code.
func stripStringsAndComments(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case isQuote(c):
			end := stringEnd(s, i)
			b.WriteByte(c)
			if end < len(s) {
				b.WriteByte(c)
			}
			i = end
		case c == '/' && i+1 < len(s) && s[i+1] == '/':
			return b.String()
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

// continues: a code line that leaves its expression open (ends in an operator,
// "=", ",", "(" or "[" …), so the next line belongs to it.
func continues(line string) bool {
	t := strings.TrimSpace(stripStringsAndComments(line))
	if t == "" {
		return false
	}
	for _, suf := range []string{"=", "+", "-", "*", "/", "%", ",", "(", "[", "?", ":", "&&", "||", ".", "=>", "!"} {
		if strings.HasSuffix(t, suf) {
			return true
		}
	}
	return false
}

// startsContinuation: a line that continues the previous one (".then(…)", "+ x" …).
func startsContinuation(line string) bool {
	t := strings.TrimSpace(line)
	for _, pre := range []string{".", "?", ":", "+", "-", "*", "/", "&&", "||", ")", "]", ","} {
		if strings.HasPrefix(t, pre) && !strings.HasPrefix(t, "//") {
			return true
		}
	}
	return false
}
