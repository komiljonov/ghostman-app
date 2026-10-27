package engine

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWT auth: a token the app builds and SIGNS AT SEND TIME from a template
// config (algorithm, secret, payload, placement) — the server stores the
// template and never sees a resolved secret or a token. Order per send:
//
//  1. ResolveSpec resolves {{vars}} in the secret and the payload with the
//     active environment's map (secrets from this machine). The {{$now}} family
//     is left alone there (resolvePayload).
//  2. SignJWT: the secret is Base64-decoded when JWTSecretBase64 is set; the
//     payload must parse as a JSON OBJECT; dynamic time claims are applied
//     (DynamicClaim); the token is signed (HS256 / HS384 / HS512, golang-jwt) and
//     stored in Auth.jwtToken.
//  3. ApplyAuth attaches it like any derived row: header <name or Authorization>:
//     <prefix or "Bearer "><token>, or <name or token>=<token> in the query.
//     User-written wins, and an Authorization header follows the cross-host
//     redirect drop rule — exactly as for the other auth types.
//
// THE DEVIATION from "unresolved vars are sent literally + a banner": an
// unresolved {{var}} in the SECRET aborts the send naming it — signing with a
// literal placeholder would mint a valid-looking but wrong token silently.
// Unresolved vars in the payload stay literal string claims and are reported
// as usual. The resolved secret is never logged, returned to the UI or written
// to history.

// JWT placements and defaults.
const (
	JWTAddToHeader = "header"
	JWTAddToQuery  = "query"

	DefaultJWTHeader = "Authorization"
	DefaultJWTQuery  = "token"
	DefaultJWTPrefix = "Bearer "
)

var jwtMethods = map[string]jwt.SigningMethod{
	"HS256": jwt.SigningMethodHS256,
	"HS384": jwt.SigningMethodHS384,
	"HS512": jwt.SigningMethodHS512,
}

// dynamicRe is the exact form of a dynamic time claim: {{$now}}, {{$now+N}},
// {{$now-N}} (N integer seconds), and nothing around it.
var dynamicRe = regexp.MustCompile(`^\{\{\$now(?:([+-])(\d+))?\}\}$`)

// DynamicClaim reports whether a payload STRING value is a dynamic time claim
// and, if so, its value: unix seconds of now, plus or minus N. Only an exact
// match counts — "{{$now}} ", "x{{$now}}", "{{$now+1.5}}", "{{ $now }}" are not
// special and stay as written.
func DynamicClaim(s string, now time.Time) (int64, bool) {
	m := dynamicRe.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	t := now.Unix()
	if m[1] != "" {
		n, err := strconv.ParseInt(m[2], 10, 64)
		if err != nil {
			return 0, false // out of range: not a claim
		}
		if m[1] == "+" {
			t += n
		} else {
			t -= n
		}
	}
	return t, true
}

// isDynamicKey: the key of a {{$now…}} token (resolution leaves those alone).
func isDynamicKey(key string) bool { return dynamicRe.MatchString("{{" + key + "}}") }

// resolvePayload resolves a JWT payload template: every {{var}} like anywhere
// else, except the {{$now…}} family, which stays for SignJWT (and is not
// reported as unresolved).
func resolvePayload(s string, res func(string) string) string {
	tokens := FindTokens(s)
	if len(tokens) == 0 {
		return s
	}
	var b strings.Builder
	last := 0
	for _, t := range tokens {
		b.WriteString(s[last:t.Start])
		tok := s[t.Start:t.End]
		if isDynamicKey(t.Key) {
			b.WriteString(tok)
		} else {
			b.WriteString(res(tok))
		}
		last = t.End
	}
	b.WriteString(s[last:])
	return b.String()
}

// applyDynamic replaces dynamic time claims in every string VALUE of a decoded
// payload (nested objects and arrays included; keys never change).
func applyDynamic(v any, now time.Time) any {
	switch x := v.(type) {
	case string:
		if n, ok := DynamicClaim(x, now); ok {
			return n
		}
		return x
	case map[string]any:
		for k, e := range x {
			x[k] = applyDynamic(e, now)
		}
		return x
	case []any:
		for i, e := range x {
			x[i] = applyDynamic(e, now)
		}
		return x
	default:
		return v
	}
}

// JWTError is a JWT that cannot be built; the send is aborted (nothing sent).
type JWTError struct{ Msg string }

func (e *JWTError) Error() string { return e.Msg }

func jwtErr(format string, a ...any) error { return &JWTError{Msg: fmt.Sprintf(format, a...)} }

// jwtSecret is the signing key from a resolved config.
func jwtSecret(a Auth) ([]byte, error) {
	if a.jwtSecretMissing != "" {
		return nil, jwtErr("JWT not signed: the secret uses %s, which has no value in the active environment on this machine — set it in Environments (or activate the right environment)",
			a.jwtSecretMissing)
	}
	if a.JWTSecret == "" {
		return nil, jwtErr("JWT not signed: the secret is empty")
	}
	if !a.JWTSecretBase64 {
		return []byte(a.JWTSecret), nil
	}
	s := strings.TrimSpace(a.JWTSecret)
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if key, err := enc.DecodeString(s); err == nil && len(key) > 0 {
			return key, nil
		}
	}
	return nil, jwtErr("JWT not signed: the secret is marked Base64 but is not valid Base64")
}

// jwtClaims parses the resolved payload: a JSON object ("" = {}), numbers kept
// exactly as written, dynamic time claims applied.
func jwtClaims(payload string, now time.Time) (jwt.MapClaims, error) {
	if strings.TrimSpace(payload) == "" {
		return jwt.MapClaims{}, nil
	}
	dec := json.NewDecoder(strings.NewReader(payload))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, jwtErr("JWT not signed: the payload is not valid JSON (%s)", jsonPosition(payload, err))
	}
	if dec.More() {
		return nil, jwtErr("JWT not signed: the payload has text after the JSON object")
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, jwtErr("JWT not signed: the payload must be a JSON object ({…})")
	}
	return jwt.MapClaims(applyDynamic(obj, now).(map[string]any)), nil
}

// jsonPosition is "line L, col C: msg" for a decode error.
func jsonPosition(s string, err error) string {
	var se *json.SyntaxError
	off := int64(-1)
	if errors.As(err, &se) {
		off = se.Offset
	} else if errors.Is(err, io.ErrUnexpectedEOF) {
		off = int64(len(s))
	}
	if off < 0 {
		return err.Error()
	}
	if off > int64(len(s)) {
		off = int64(len(s))
	}
	before := s[:off]
	line := strings.Count(before, "\n") + 1
	col := int(off) - strings.LastIndex(before, "\n")
	return fmt.Sprintf("line %d, col %d: %s", line, col, err.Error())
}

// SignJWT signs a resolved spec's JWT auth (see the package comment above) and
// stores the token for ApplyAuth. Other auth types pass through. Call it ONCE
// per send, after ResolveSpec: the same token then goes out and into history.
func SignJWT(spec RequestSpec, now time.Time) (RequestSpec, error) {
	if spec.Auth == nil || spec.Auth.Type != AuthJWT {
		return spec, nil
	}
	a := *spec.Auth
	method, ok := jwtMethods[a.JWTAlgorithm]
	if !ok {
		if a.JWTAlgorithm != "" {
			return spec, jwtErr("JWT not signed: unsupported algorithm %q (use HS256, HS384 or HS512)", a.JWTAlgorithm)
		}
		method = jwt.SigningMethodHS256
	}
	key, err := jwtSecret(a)
	if err != nil {
		return spec, err
	}
	claims, err := jwtClaims(a.JWTPayload, now)
	if err != nil {
		return spec, err
	}
	token, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		return spec, jwtErr("JWT not signed: %v", err)
	}
	a.jwtToken = token
	spec.Auth = &a
	return spec, nil
}

// jwtRow is the derived header / query row of a signed config (nil, nil when
// it was not signed).
func jwtRow(a Auth) (h *Header, q *Header) {
	if a.jwtToken == "" {
		return nil, nil
	}
	name := strings.TrimSpace(a.JWTName)
	if a.JWTAddTo == JWTAddToQuery {
		if name == "" {
			name = DefaultJWTQuery
		}
		return nil, &Header{Key: name, Value: a.jwtToken, Enabled: true}
	}
	if name == "" {
		name = DefaultJWTHeader
	}
	prefix := a.JWTPrefix
	if prefix == "" {
		prefix = DefaultJWTPrefix
	}
	return &Header{Key: name, Value: prefix + a.jwtToken, Enabled: true}, nil
}

// JWTPreview is what the preview popover shows: the token's decoded header and
// claims as they would be signed now, and the token's first and last 8
// characters. The secret is never part of it.
type JWTPreview struct {
	Header    string `json:"header"`  // pretty JSON
	Payload   string `json:"payload"` // pretty JSON, resolved, time claims applied
	TokenHead string `json:"token_head"`
	TokenTail string `json:"token_tail"`
}

// PreviewJWT signs a resolved spec's JWT and decodes its header and payload.
func PreviewJWT(spec RequestSpec, now time.Time) (JWTPreview, error) {
	signed, err := SignJWT(spec, now)
	if err != nil {
		return JWTPreview{}, err
	}
	if signed.Auth == nil || signed.Auth.jwtToken == "" {
		return JWTPreview{}, jwtErr("not a JWT auth config")
	}
	tok := signed.Auth.jwtToken
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return JWTPreview{}, jwtErr("unexpected token shape")
	}
	pretty := func(seg string) string {
		raw, err := base64.RawURLEncoding.DecodeString(seg)
		if err != nil {
			return ""
		}
		var b bytes.Buffer
		if json.Indent(&b, raw, "", "  ") != nil {
			return string(raw)
		}
		return b.String()
	}
	head, tail := tok, tok
	if len(tok) > 8 {
		head, tail = tok[:8], tok[len(tok)-8:]
	}
	return JWTPreview{Header: pretty(parts[0]), Payload: pretty(parts[1]), TokenHead: head, TokenTail: tail}, nil
}
