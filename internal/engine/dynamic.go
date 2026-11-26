package engine

import (
	"crypto/rand"
	"encoding/hex"
	"math/big"
	"regexp"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Dynamic (generated) variables — {{$name}} tokens whose value is generated at
// send time instead of read from an environment. ONE implementation, shared
// with the JWT time claims (jwt.go: DynamicClaim reads NowOffset).
//
//	{{$uuid}}          a random UUID v4
//	{{$now}}           unix seconds now; {{$now+N}} / {{$now-N}} N seconds later / earlier
//	{{$timestamp}}     alias of {{$now}}
//	{{$isoTimestamp}}  now as RFC 3339 in UTC, e.g. 2026-11-26T09:15:02Z
//	{{$date}}          today as YYYY-MM-DD in local time
//	{{$randomInt}}     a random integer 0–999999
//	{{$randomHex}}     16 random hex characters
//
// Rules:
//   - The key must match exactly (case-sensitive, no spaces), like every {{var}}.
//   - Any key starting with "$" is dynamic: environment keys never start with "$"
//     (internal/envs refuses them). An unknown $name stays literal and is
//     reported as unresolved, like an unknown variable.
//   - Values are generated fresh for every send, and ONE value per distinct token
//     TEXT per send: {{$uuid}} twice in a request is the same UUID (unlike
//     Postman, which draws a new one per occurrence) — so a header and a body
//     can carry the same correlation id. {{$now}} and {{$now+60}} share one
//     clock reading.

// nowKeyRe is the exact form of a time key: $now, $now+N, $now-N (N integer seconds).
var nowKeyRe = regexp.MustCompile(`^\$now(?:([+-])(\d+))?$`)

// NowOffset reports whether key is $now / $now+N / $now-N and, if so, its value
// in unix seconds relative to now.
func NowOffset(key string, now time.Time) (int64, bool) {
	m := nowKeyRe.FindStringSubmatch(key)
	if m == nil {
		return 0, false
	}
	t := now.Unix()
	if m[1] != "" {
		n, err := strconv.ParseInt(m[2], 10, 64)
		if err != nil {
			return 0, false // out of range: not a time key
		}
		if m[1] == "+" {
			t += n
		} else {
			t -= n
		}
	}
	return t, true
}

// IsDynamicKey reports whether a token key names a generated variable ("$…"),
// known or not.
func IsDynamicKey(key string) bool { return len(key) > 0 && key[0] == '$' }

// Generator produces the values of one send: one clock reading, and one value
// per distinct key (memoized). The zero value is not usable; use NewGenerator.
type Generator struct {
	now  time.Time
	vals map[string]string
	// random sources, replaceable in tests
	uuid      func() string
	randomInt func() int64
	randomHex func() string
}

// NewGenerator returns a generator for one send at the given time.
func NewGenerator(now time.Time) *Generator {
	return &Generator{
		now:       now,
		vals:      map[string]string{},
		uuid:      uuid.NewString,
		randomInt: func() int64 { n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000)); return n.Int64() },
		randomHex: func() string { b := make([]byte, 8); _, _ = rand.Read(b); return hex.EncodeToString(b) },
	}
}

// Value returns the value of a dynamic key (without braces), or false for an
// unknown one. The same key always returns the same value from one generator.
func (g *Generator) Value(key string) (string, bool) {
	if v, ok := g.vals[key]; ok {
		return v, true
	}
	v, ok := g.generate(key)
	if ok {
		g.vals[key] = v
	}
	return v, ok
}

func (g *Generator) generate(key string) (string, bool) {
	if t, ok := NowOffset(key, g.now); ok {
		return strconv.FormatInt(t, 10), true
	}
	switch key {
	case "$uuid":
		return g.uuid(), true
	case "$timestamp":
		return strconv.FormatInt(g.now.Unix(), 10), true
	case "$isoTimestamp":
		return g.now.UTC().Format(time.RFC3339), true
	case "$date":
		return g.now.Local().Format(time.DateOnly), true
	case "$randomInt":
		return strconv.FormatInt(g.randomInt(), 10), true
	case "$randomHex":
		return g.randomHex(), true
	}
	return "", false
}
