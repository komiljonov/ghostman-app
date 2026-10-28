// Package authmemory is auth-field memory, Postman-style: the last values the
// user saved for an auth type (per project) prefill that type's fields when it
// is chosen on a node whose fields for it are all empty.
//
// The rules, all pure (the store and the bound call live in auth_memory.go):
//
//   - Remembered types: bearer, basic, api_key, jwt. Inherit / none have no
//     fields — nothing is captured or prefilled for them.
//   - The fields of a type: bearer → token; basic → username, password;
//     api_key → name, value, in; jwt → algorithm, secret, base64 flag, payload,
//     add_to, name, prefix. {{vars}} and {{$now…}} are kept verbatim.
//   - Empty: every TEXT field of the type is "" — the enums (api_key in, jwt
//     algorithm / add_to) and the base64 flag have defaults, so they never count
//     as filled. jwt is empty when secret AND payload are "" (its name / prefix
//     are optional refinements).
//   - Capture: a save that CHANGES at least one field of the node's type, with
//     that type remembered and not Empty, stores the type's fields (last write
//     wins). A pure mode switch saves no fields and captures nothing — otherwise
//     switching to a type whose values the server kept from earlier (another
//     node's own creds, a half-filled payload) would overwrite the memory.
//   - Prefill: switching to a remembered type on a node where that type is
//     Empty copies the memory in. ANY value already there — typed, or kept by
//     the server from an earlier switch — means nothing is touched.
//
// LOCAL ONLY by design: remembered values may be literal secrets; they never
// sync and are never logged.
package authmemory

import "ghostman/internal/api"

// Remembered reports whether a type has fields to remember.
func Remembered(t string) bool {
	switch t {
	case api.AuthBearer, api.AuthBasic, api.AuthAPIKey, api.AuthJWT:
		return true
	}
	return false
}

// Empty reports whether every field of type t on a is empty (see the package doc).
func Empty(t string, a api.Auth) bool {
	switch t {
	case api.AuthBearer:
		return a.BearerToken == ""
	case api.AuthBasic:
		return a.BasicUsername == "" && a.BasicPassword == ""
	case api.AuthAPIKey:
		return a.APIKeyName == "" && a.APIKeyValue == ""
	case api.AuthJWT:
		return a.JWTSecret == "" && a.JWTPayload == ""
	}
	return true
}

// Extract is what a save of a remembers: its type's fields only (everything else
// zero). ok is false when there is nothing to remember (type not remembered, or
// its fields are empty).
func Extract(a api.Auth) (api.Auth, bool) {
	a = api.NormalizeAuth(a)
	if !Remembered(a.Type) || Empty(a.Type, a) {
		return api.Auth{}, false
	}
	return apply(api.Auth{Type: a.Type}, a.Type, a), true
}

// Captures reports whether saving base → next is a capture (see the package doc);
// what to store is then Extract(next).
func Captures(base, next api.Auth) bool {
	b, n := api.NormalizeAuth(base), api.NormalizeAuth(next)
	if !Remembered(n.Type) || Empty(n.Type, n) {
		return false
	}
	return apply(api.Auth{}, n.Type, b) != apply(api.Auth{}, n.Type, n)
}

// Switch is a mode switch of a to type t: only the type changes (every field is
// kept, as everywhere), except that the remembered fields of t are copied in
// when mem is set and t's fields on a are all empty. prefilled says which.
func Switch(a api.Auth, t string, mem *api.Auth) (out api.Auth, prefilled bool) {
	a.Type = t
	if mem == nil || !Remembered(t) || !Empty(t, a) {
		return a, false
	}
	return api.NormalizeAuth(apply(a, t, *mem)), true
}

// apply copies the fields of type t from src onto dst.
func apply(dst api.Auth, t string, src api.Auth) api.Auth {
	switch t {
	case api.AuthBearer:
		dst.BearerToken = src.BearerToken
	case api.AuthBasic:
		dst.BasicUsername, dst.BasicPassword = src.BasicUsername, src.BasicPassword
	case api.AuthAPIKey:
		dst.APIKeyName, dst.APIKeyValue, dst.APIKeyIn = src.APIKeyName, src.APIKeyValue, src.APIKeyIn
	case api.AuthJWT:
		dst.JWTAlgorithm, dst.JWTSecret, dst.JWTSecretBase64 = src.JWTAlgorithm, src.JWTSecret, src.JWTSecretBase64
		dst.JWTPayload, dst.JWTAddTo, dst.JWTName, dst.JWTPrefix = src.JWTPayload, src.JWTAddTo, src.JWTName, src.JWTPrefix
	}
	return dst
}
