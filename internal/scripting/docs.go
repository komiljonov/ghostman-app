package scripting

// APIDocs is the ONE description of the gm API: the script editors' help popover
// renders it (bound GetScriptAPIDocs), and TestDocsMatchTheAPI fails when an entry
// names something the VM does not have, or the VM has something undocumented.

// Doc is one API member.
type Doc struct {
	Group   string `json:"group"`   // "gm.environment", ...
	Name    string `json:"name"`    // the member path, e.g. "gm.environment.get"
	Usage   string `json:"usage"`   // call form
	Summary string `json:"summary"` // one line
	Example string `json:"example"`
	Where   string `json:"where"`   // "pre", "post", "" = both
	Returns string `json:"returns"` // what a call / read gives: "string | null", "void", …
}

// APIDocs lists every member, grouped, in display order.
var APIDocs = []Doc{
	{"gm.environment", "gm.environment.get", "gm.environment.get(key)", "The active environment's value (secrets from this machine), or null.", `const token = gm.environment.get("token")`, "", "string | null"},
	{"gm.environment", "gm.environment.set", "gm.environment.set(key, value)", "Writes to the active environment: a secret stays on this machine, a regular value syncs, a new key becomes a regular variable. In a pre-script it resolves {{key}} in this very send.", `gm.environment.set("token", gm.response.json().token)`, "", "void"},
	{"gm.environment", "gm.environment.unset", "gm.environment.unset(key)", "Clears the variable's value (the variable itself stays).", `gm.environment.unset("token")`, "", "void"},
	{"gm.environment", "gm.environment.name", "gm.environment.name", "The active environment's name, or null.", `console.log(gm.environment.name)`, "", "string | null"},

	{"gm.request", "gm.request.method", "gm.request.method", "The method; settable in pre-scripts.", `gm.request.method = "POST"`, "", "string"},
	{"gm.request", "gm.request.url", "gm.request.url", "The URL in template form ({{vars}} visible); settable in pre-scripts.", `gm.request.url = gm.request.url + "/v2"`, "", "string"},
	{"gm.request", "gm.request.headers.get", "gm.request.headers.get(name)", "An enabled header's value (name case-insensitive), or null.", `gm.request.headers.get("Content-Type")`, "", "string | null"},
	{"gm.request", "gm.request.headers.set", "gm.request.headers.set(name, value)", "Replaces the header, or adds it.", `gm.request.headers.set("X-Signature", sig)`, "pre", "void"},
	{"gm.request", "gm.request.headers.add", "gm.request.headers.add(name, value)", "Adds one more header row.", `gm.request.headers.add("X-Trace", gm.crypto.uuid())`, "pre", "void"},
	{"gm.request", "gm.request.headers.remove", "gm.request.headers.remove(name)", "Removes every header with that name.", `gm.request.headers.remove("X-Debug")`, "pre", "void"},
	{"gm.request", "gm.request.headers.all", "gm.request.headers.all()", "Every enabled header as {key, value}.", `gm.request.headers.all().length`, "", "{ key, value }[]"},
	{"gm.request", "gm.request.query.get", "gm.request.query.get(name)", "An enabled query parameter's value, or null.", `gm.request.query.get("page")`, "", "string | null"},
	{"gm.request", "gm.request.query.set", "gm.request.query.set(name, value)", "Replaces the parameter, or adds it.", `gm.request.query.set("ts", String(gm.crypto.timestamp()))`, "pre", "void"},
	{"gm.request", "gm.request.query.add", "gm.request.query.add(name, value)", "Adds one more parameter.", `gm.request.query.add("tag", "a")`, "pre", "void"},
	{"gm.request", "gm.request.query.remove", "gm.request.query.remove(name)", "Removes every parameter with that name.", `gm.request.query.remove("debug")`, "pre", "void"},
	{"gm.request", "gm.request.query.all", "gm.request.query.all()", "Every enabled parameter as {key, value}.", `gm.request.query.all()`, "", "{ key, value }[]"},
	{"gm.request", "gm.request.body.get", "gm.request.body.get()", "The body text (a form as urlencoded text, form-data as \"key: value\" lines with files as placeholders; \"\" for none).", `const body = gm.request.body.get()`, "", "string"},
	{"gm.request", "gm.request.body.set", "gm.request.body.set(text)", "Replaces the body with raw text.", `gm.request.body.set(JSON.stringify({ a: 1 }))`, "pre", "void"},
	{"gm.request", "gm.request.bodyType", "gm.request.bodyType", "\"none\", \"raw\", \"form\" or \"multipart\".", `if (gm.request.bodyType === "raw") { … }`, "", "string"},

	{"gm.response", "gm.response.status", "gm.response.status", "The status code.", `if (gm.response.status !== 200) throw new Error("login failed")`, "post", "number"},
	{"gm.response", "gm.response.durationMs", "gm.response.durationMs", "How long the send took, in ms.", `console.log(gm.response.durationMs)`, "post", "number"},
	{"gm.response", "gm.response.headers.get", "gm.response.headers.get(name)", "A response header's value (case-insensitive), or null.", `gm.response.headers.get("X-RateLimit-Remaining")`, "post", "string | null"},
	{"gm.response", "gm.response.headers.all", "gm.response.headers.all()", "Every response header as {key, value}.", `gm.response.headers.all()`, "post", "{ key, value }[]"},
	{"gm.response", "gm.response.text", "gm.response.text()", "The body as text.", `gm.response.text().includes("ok")`, "post", "string"},
	{"gm.response", "gm.response.json", "gm.response.json()", "The body parsed as JSON (throws when it is not JSON).", `const { token } = gm.response.json()`, "post", "any"},

	{"gm.crypto", "gm.crypto.hmacSHA256", "gm.crypto.hmacSHA256(message, secret)", "HMAC-SHA256 as hex.", `gm.crypto.hmacSHA256(gm.request.body.get(), gm.environment.get("SECRET"))`, "", "string (hex)"},
	{"gm.crypto", "gm.crypto.hmacSHA1", "gm.crypto.hmacSHA1(message, secret)", "HMAC-SHA1 as hex.", `gm.crypto.hmacSHA1("data", "key")`, "", "string (hex)"},
	{"gm.crypto", "gm.crypto.hmacSHA512", "gm.crypto.hmacSHA512(message, secret)", "HMAC-SHA512 as hex.", `gm.crypto.hmacSHA512("data", "key")`, "", "string (hex)"},
	{"gm.crypto", "gm.crypto.sha256", "gm.crypto.sha256(message)", "SHA-256 as hex.", `gm.crypto.sha256(gm.request.body.get())`, "", "string (hex)"},
	{"gm.crypto", "gm.crypto.md5", "gm.crypto.md5(message)", "MD5 as hex.", `gm.crypto.md5("data")`, "", "string (hex)"},
	{"gm.crypto", "gm.crypto.base64Encode", "gm.crypto.base64Encode(text)", "Base64-encodes text.", `"Basic " + gm.crypto.base64Encode(user + ":" + pass)`, "", "string"},
	{"gm.crypto", "gm.crypto.base64Decode", "gm.crypto.base64Decode(text)", "Decodes base64 (standard or URL-safe).", `gm.crypto.base64Decode(jwt.split(".")[1])`, "", "string"},
	{"gm.crypto", "gm.crypto.uuid", "gm.crypto.uuid()", "A random UUID v4.", `gm.request.headers.set("X-Request-Id", gm.crypto.uuid())`, "", "string"},
	{"gm.crypto", "gm.crypto.randomHex", "gm.crypto.randomHex(n)", "n random bytes (1–1024) as hex.", `gm.crypto.randomHex(16)`, "", "string (hex)"},
	{"gm.crypto", "gm.crypto.timestamp", "gm.crypto.timestamp()", "The current Unix time in seconds.", `String(gm.crypto.timestamp())`, "", "number"},

	{"gm.console", "gm.console.log", "console.log(...values)", "Writes to the Console tab (objects as JSON). Also gm.console.log.", `console.log("token", gm.environment.get("token"))`, "", "void"},
	{"gm.console", "gm.console.warn", "console.warn(...values)", "A warning line.", `console.warn("slow:", gm.response.durationMs)`, "", "void"},
	{"gm.console", "gm.console.error", "console.error(...values)", "An error line (the Console badge turns red).", `console.error("unexpected status", gm.response.status)`, "", "void"},
	{"gm.console", "gm.console.info", "console.info(...values)", "Same as console.log.", `console.info("done")`, "", "void"},
}
