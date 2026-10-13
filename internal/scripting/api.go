package scripting

import (
	"crypto/hmac"
	"crypto/md5" //nolint:gosec // gm.crypto.md5 is a user-requested digest, not a security primitive here
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // HMAC-SHA1 signatures are what some APIs require
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"net/url"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/google/uuid"

	"ghostman/internal/engine"
)

// The gm API: the ONLY globals besides ECMAScript built-ins (documented in
// docs.go — TestDocsMatchTheAPI keeps the two in step).
//
//	gm.environment  get / set / unset / name   (the active environment)
//	gm.request      method, url, headers, query, body, bodyType (mutable in pre-scripts)
//	gm.response     status, durationMs, headers, text(), json()  (post-scripts only)
//	gm.crypto       hmacSHA256 / hmacSHA1 / hmacSHA512, sha256, md5, base64Encode /
//	                base64Decode, uuid, randomHex, timestamp
//	gm.console      log / warn / error   (also as the bare global console)

const maxRandomBytes = 1024

type api struct {
	vm   *goja.Runtime
	s    Script
	req  *engine.RequestSpec
	resp *Response
	env  *EnvState
	con  *Console
}

// throw raises a plain JS Error (catchable in the script, "Error: msg" when not).
func (a *api) throw(format string, args ...any) {
	ctor, _ := goja.AssertConstructor(a.vm.Get("Error"))
	obj, err := ctor(nil, a.vm.ToValue(fmt.Sprintf(format, args...)))
	if err != nil {
		panic(a.vm.NewGoError(fmt.Errorf(format, args...)))
	}
	panic(obj)
}

func (a *api) fn(f func(goja.FunctionCall) goja.Value) goja.Value { return a.vm.ToValue(f) }

// str reads argument i as a string; required arguments throw when missing.
func (a *api) str(call goja.FunctionCall, i int, what string) string {
	v := call.Argument(i)
	if goja.IsUndefined(v) || goja.IsNull(v) {
		a.throw("%s is required", what)
	}
	return v.String()
}

func install(vm *goja.Runtime, s Script, req *engine.RequestSpec, resp *Response, env *EnvState, con *Console) error {
	a := &api{vm: vm, s: s, req: req, resp: resp, env: env, con: con}
	gm := vm.NewObject()
	console := a.console()
	for name, v := range map[string]goja.Value{
		"environment": a.environment(),
		"request":     a.request(),
		"response":    a.response(),
		"crypto":      a.crypto(),
		"console":     console,
	} {
		if err := gm.Set(name, v); err != nil {
			return err
		}
	}
	if err := vm.Set("gm", gm); err != nil {
		return err
	}
	return vm.Set("console", console)
}

// ---- gm.environment ----

func (a *api) environment() goja.Value {
	o := a.vm.NewObject()
	_ = o.Set("get", a.fn(func(call goja.FunctionCall) goja.Value {
		v, ok := a.env.Vars[a.str(call, 0, "gm.environment.get(key): key")]
		if !ok || a.env.Name == "" {
			return goja.Null()
		}
		return a.vm.ToValue(v)
	}))
	_ = o.Set("set", a.fn(func(call goja.FunctionCall) goja.Value {
		key := strings.TrimSpace(a.str(call, 0, "gm.environment.set(key, value): key"))
		value := a.str(call, 1, "gm.environment.set(key, value): value")
		if a.env.Name == "" {
			a.throw("gm.environment.set: no active environment — select one in the environment switcher")
		}
		if key == "" {
			a.throw("gm.environment.set: the key is empty")
		}
		a.env.Vars[key] = value
		a.env.Pending = append(a.env.Pending, EnvWrite{Key: key, Value: value})
		return goja.Undefined()
	}))
	_ = o.Set("unset", a.fn(func(call goja.FunctionCall) goja.Value {
		key := strings.TrimSpace(a.str(call, 0, "gm.environment.unset(key): key"))
		if a.env.Name == "" {
			a.throw("gm.environment.unset: no active environment — select one in the environment switcher")
		}
		delete(a.env.Vars, key)
		a.env.Pending = append(a.env.Pending, EnvWrite{Key: key, Unset: true})
		return goja.Undefined()
	}))
	_ = o.DefineAccessorProperty("name", a.fn(func(goja.FunctionCall) goja.Value {
		if a.env.Name == "" {
			return goja.Null()
		}
		return a.vm.ToValue(a.env.Name)
	}), nil, goja.FLAG_FALSE, goja.FLAG_TRUE)
	return o
}

// ---- gm.request ----

func (a *api) mutable(what string) {
	if a.s.Phase != Pre {
		a.throw("gm.request is read-only in post-response scripts (%s)", what)
	}
}

func (a *api) request() goja.Value {
	o := a.vm.NewObject()
	accessor := func(name string, get func() string, set func(string)) {
		_ = o.DefineAccessorProperty(name,
			a.fn(func(goja.FunctionCall) goja.Value { return a.vm.ToValue(get()) }),
			a.fn(func(call goja.FunctionCall) goja.Value {
				a.mutable("gm.request." + name)
				set(a.str(call, 0, "gm.request."+name))
				return goja.Undefined()
			}), goja.FLAG_FALSE, goja.FLAG_TRUE)
	}
	accessor("method", func() string { return a.req.Method }, func(v string) { a.req.Method = strings.ToUpper(strings.TrimSpace(v)) })
	accessor("url", func() string { return a.req.URL }, func(v string) { a.req.URL = v })
	_ = o.Set("headers", a.rows("gm.request.headers", &a.req.Headers, true))
	_ = o.Set("query", a.rows("gm.request.query", &a.req.QueryParams, false))
	body := a.vm.NewObject()
	_ = body.Set("get", a.fn(func(goja.FunctionCall) goja.Value { return a.vm.ToValue(bodyText(a.req.Body)) }))
	_ = body.Set("set", a.fn(func(call goja.FunctionCall) goja.Value {
		a.mutable("gm.request.body.set")
		text := a.str(call, 0, "gm.request.body.set(text): text")
		switch a.req.Body.Type {
		case engine.BodyForm:
			a.req.Body.ContentType = "application/x-www-form-urlencoded"
		case engine.BodyRaw:
		default:
			a.req.Body.ContentType = "text/plain"
		}
		a.req.Body.Type, a.req.Body.Content = engine.BodyRaw, text
		return goja.Undefined()
	}))
	_ = o.Set("body", body)
	_ = o.DefineAccessorProperty("bodyType", a.fn(func(goja.FunctionCall) goja.Value {
		t := a.req.Body.Type
		if t == "" {
			t = engine.BodyNone
		}
		return a.vm.ToValue(t)
	}), nil, goja.FLAG_FALSE, goja.FLAG_TRUE)
	return o
}

// bodyText is the body as the script reads it: raw content, a form as
// urlencoded text of its enabled fields, "" for none.
func bodyText(b engine.Body) string {
	switch b.Type {
	case engine.BodyRaw:
		return b.Content
	case engine.BodyForm:
		v := url.Values{}
		var keys []string
		for _, f := range b.Fields {
			if f.Enabled && f.Key != "" {
				if _, ok := v[f.Key]; !ok {
					keys = append(keys, f.Key)
				}
				v.Add(f.Key, f.Value)
			}
		}
		var parts []string
		for _, k := range keys {
			for _, val := range v[k] {
				parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(val))
			}
		}
		return strings.Join(parts, "&")
	}
	return ""
}

// rows is the headers / query API over a row list (headers: names
// case-insensitive; query: exact). Only enabled rows count.
func (a *api) rows(what string, list *[]engine.Header, foldCase bool) goja.Value {
	same := func(x, y string) bool {
		if foldCase {
			return strings.EqualFold(strings.TrimSpace(x), strings.TrimSpace(y))
		}
		return x == y
	}
	o := a.vm.NewObject()
	_ = o.Set("get", a.fn(func(call goja.FunctionCall) goja.Value {
		name := a.str(call, 0, what+".get(name): name")
		for _, r := range *list {
			if r.Enabled && same(r.Key, name) {
				return a.vm.ToValue(r.Value)
			}
		}
		return goja.Null()
	}))
	_ = o.Set("set", a.fn(func(call goja.FunctionCall) goja.Value {
		a.mutable(what + ".set")
		name, value := a.str(call, 0, what+".set(name, value): name"), a.str(call, 1, what+".set(name, value): value")
		for i, r := range *list {
			if r.Enabled && same(r.Key, name) {
				(*list)[i].Value = value
				return goja.Undefined()
			}
		}
		*list = append(*list, engine.Header{Key: name, Value: value, Enabled: true})
		return goja.Undefined()
	}))
	_ = o.Set("add", a.fn(func(call goja.FunctionCall) goja.Value {
		a.mutable(what + ".add")
		*list = append(*list, engine.Header{Key: a.str(call, 0, what+".add(name, value): name"),
			Value: a.str(call, 1, what+".add(name, value): value"), Enabled: true})
		return goja.Undefined()
	}))
	_ = o.Set("remove", a.fn(func(call goja.FunctionCall) goja.Value {
		a.mutable(what + ".remove")
		name := a.str(call, 0, what+".remove(name): name")
		kept := (*list)[:0:0]
		for _, r := range *list {
			if !same(r.Key, name) {
				kept = append(kept, r)
			}
		}
		*list = kept
		return goja.Undefined()
	}))
	_ = o.Set("all", a.fn(func(goja.FunctionCall) goja.Value {
		out := []any{}
		for _, r := range *list {
			if r.Enabled && r.Key != "" {
				out = append(out, map[string]any{"key": r.Key, "value": r.Value})
			}
		}
		return a.vm.ToValue(out)
	}))
	return o
}

// ---- gm.response ----

func (a *api) response() goja.Value {
	if a.resp == nil {
		// Pre-scripts: any use throws a clear error instead of "undefined" surprises.
		o := a.vm.NewObject()
		for _, name := range []string{"status", "durationMs"} {
			_ = o.DefineAccessorProperty(name, a.fn(func(goja.FunctionCall) goja.Value {
				a.throw("gm.response is only available in post-response scripts")
				return nil
			}), nil, goja.FLAG_FALSE, goja.FLAG_TRUE)
		}
		for _, name := range []string{"text", "json"} {
			_ = o.Set(name, a.fn(func(goja.FunctionCall) goja.Value {
				a.throw("gm.response is only available in post-response scripts")
				return nil
			}))
		}
		headers := a.vm.NewObject()
		for _, name := range []string{"get", "all"} {
			_ = headers.Set(name, a.fn(func(goja.FunctionCall) goja.Value {
				a.throw("gm.response is only available in post-response scripts")
				return nil
			}))
		}
		_ = o.Set("headers", headers)
		return o
	}
	o := a.vm.NewObject()
	_ = o.Set("status", a.resp.Status)
	_ = o.Set("durationMs", a.resp.DurationMs)
	headers := a.vm.NewObject()
	_ = headers.Set("get", a.fn(func(call goja.FunctionCall) goja.Value {
		name := a.str(call, 0, "gm.response.headers.get(name): name")
		for _, h := range a.resp.Headers {
			if strings.EqualFold(h.Key, name) {
				return a.vm.ToValue(h.Value)
			}
		}
		return goja.Null()
	}))
	_ = headers.Set("all", a.fn(func(goja.FunctionCall) goja.Value {
		out := []any{}
		for _, h := range a.resp.Headers {
			out = append(out, map[string]any{"key": h.Key, "value": h.Value})
		}
		return a.vm.ToValue(out)
	}))
	_ = o.Set("headers", headers)
	_ = o.Set("text", a.fn(func(goja.FunctionCall) goja.Value { return a.vm.ToValue(string(a.resp.Body)) }))
	_ = o.Set("json", a.fn(func(goja.FunctionCall) goja.Value {
		parse, _ := goja.AssertFunction(a.vm.Get("JSON").ToObject(a.vm).Get("parse"))
		v, err := parse(goja.Undefined(), a.vm.ToValue(string(a.resp.Body)))
		if err != nil {
			a.throw("gm.response.json(): the body is not valid JSON")
		}
		return v
	}))
	return o
}

// ---- gm.crypto ----

func (a *api) crypto() goja.Value {
	o := a.vm.NewObject()
	hmacFn := func(name string, h func() hash.Hash) {
		_ = o.Set(name, a.fn(func(call goja.FunctionCall) goja.Value {
			msg := a.str(call, 0, "gm.crypto."+name+"(message, secret): message")
			secret := a.str(call, 1, "gm.crypto."+name+"(message, secret): secret")
			m := hmac.New(h, []byte(secret))
			m.Write([]byte(msg))
			return a.vm.ToValue(hex.EncodeToString(m.Sum(nil)))
		}))
	}
	hmacFn("hmacSHA256", sha256.New)
	hmacFn("hmacSHA1", sha1.New)
	hmacFn("hmacSHA512", sha512.New)
	digest := func(name string, h func() hash.Hash) {
		_ = o.Set(name, a.fn(func(call goja.FunctionCall) goja.Value {
			d := h()
			d.Write([]byte(a.str(call, 0, "gm.crypto."+name+"(message): message")))
			return a.vm.ToValue(hex.EncodeToString(d.Sum(nil)))
		}))
	}
	digest("sha256", sha256.New)
	digest("md5", md5.New)
	_ = o.Set("base64Encode", a.fn(func(call goja.FunctionCall) goja.Value {
		return a.vm.ToValue(base64.StdEncoding.EncodeToString([]byte(a.str(call, 0, "gm.crypto.base64Encode(text): text"))))
	}))
	_ = o.Set("base64Decode", a.fn(func(call goja.FunctionCall) goja.Value {
		in := strings.TrimSpace(a.str(call, 0, "gm.crypto.base64Decode(text): text"))
		out, err := base64.StdEncoding.DecodeString(in)
		if err != nil {
			if out, err = base64.RawURLEncoding.DecodeString(strings.TrimRight(in, "=")); err != nil {
				a.throw("gm.crypto.base64Decode: the text is not valid base64")
			}
		}
		return a.vm.ToValue(string(out))
	}))
	_ = o.Set("uuid", a.fn(func(goja.FunctionCall) goja.Value { return a.vm.ToValue(uuid.NewString()) }))
	_ = o.Set("randomHex", a.fn(func(call goja.FunctionCall) goja.Value {
		n := call.Argument(0).ToInteger()
		if n < 1 || n > maxRandomBytes {
			a.throw("gm.crypto.randomHex(n): n must be between 1 and %d (bytes)", maxRandomBytes)
		}
		b := make([]byte, n)
		if _, err := rand.Read(b); err != nil {
			a.throw("gm.crypto.randomHex: %v", err)
		}
		return a.vm.ToValue(hex.EncodeToString(b))
	}))
	_ = o.Set("timestamp", a.fn(func(goja.FunctionCall) goja.Value { return a.vm.ToValue(time.Now().Unix()) }))
	return o
}

// ---- gm.console / console ----

func (a *api) console() goja.Value {
	o := a.vm.NewObject()
	for _, level := range []string{"log", "warn", "error"} {
		_ = o.Set(level, a.fn(func(call goja.FunctionCall) goja.Value {
			parts := make([]string, len(call.Arguments))
			for i, v := range call.Arguments {
				parts[i] = a.format(v)
			}
			a.con.add(Entry{Owner: a.s.Owner, Phase: a.s.Phase, Level: level, Text: strings.Join(parts, " ")})
			return goja.Undefined()
		}))
	}
	_ = o.Set("info", o.Get("log"))
	return o
}

// format renders a console argument: strings as is, objects as indented JSON,
// errors and functions by their string form.
func (a *api) format(v goja.Value) string {
	switch {
	case goja.IsUndefined(v):
		return "undefined"
	case goja.IsNull(v):
		return "null"
	}
	obj, ok := v.(*goja.Object)
	if !ok {
		return v.String()
	}
	if _, isFn := goja.AssertFunction(v); isFn {
		return "[Function]"
	}
	if obj.ClassName() == "Error" {
		return v.String()
	}
	stringify, _ := goja.AssertFunction(a.vm.Get("JSON").ToObject(a.vm).Get("stringify"))
	out, err := stringify(goja.Undefined(), v, goja.Null(), a.vm.ToValue(2))
	if err != nil || goja.IsUndefined(out) {
		var ex *goja.Exception
		if errors.As(err, &ex) {
			return "[unprintable: " + ex.Value().String() + "]"
		}
		return v.String()
	}
	return out.String()
}
