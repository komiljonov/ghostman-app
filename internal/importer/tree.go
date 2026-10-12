package importer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// An order-preserving document tree for OpenAPI / Swagger files. Go maps lose
// key order, and order matters here (tags, operations in spec order, the
// property order of a generated body), so specs are read into this tree:
//
//	*omap        a JSON object / YAML mapping, keys in file order
//	[]any        an array / sequence
//	string, json.Number, bool, nil
//
// JSON is read with a token decoder (numbers stay json.Number, verbatim); YAML
// via yaml.v3 nodes, converted to the same shapes.

type omap struct {
	keys []string
	vals map[string]any
}

func newOmap() *omap { return &omap{vals: map[string]any{}} }

func (o *omap) set(k string, v any) {
	if _, ok := o.vals[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.vals[k] = v
}

// Keys are the object's keys in order (nil-safe).
func (o *omap) Keys() []string {
	if o == nil {
		return nil
	}
	return o.keys
}

func (o *omap) get(k string) any {
	if o == nil {
		return nil
	}
	return o.vals[k]
}

func (o *omap) has(k string) bool {
	if o == nil {
		return false
	}
	_, ok := o.vals[k]
	return ok
}

// Typed accessors (nil-safe; a wrong type reads as absent).
func (o *omap) obj(k string) *omap { m, _ := o.get(k).(*omap); return m }
func (o *omap) arr(k string) []any { a, _ := o.get(k).([]any); return a }
func (o *omap) str(k string) string {
	switch v := o.get(k).(type) {
	case string:
		return v
	case json.Number:
		return v.String()
	}
	return ""
}
func (o *omap) boolean(k string) bool { b, _ := o.get(k).(bool); return b }

// MarshalJSON writes the object with its keys in order.
func (o *omap) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := marshalValue(o.vals[k])
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func marshalValue(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// prettyJSON is v as 2-space-indented JSON, key order kept.
func prettyJSON(v any) string {
	raw, err := marshalValue(v)
	if err != nil {
		return ""
	}
	var out bytes.Buffer
	if json.Indent(&out, raw, "", "  ") != nil {
		return string(raw)
	}
	return out.String()
}

// decodeTree reads JSON or YAML (sniffed: a JSON document starts with "{" or "[").
func decodeTree(data []byte) (any, error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	trimmed := bytes.TrimLeft(data, " \t\r\n")
	if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') {
		return decodeJSONTree(trimmed)
	}
	return decodeYAMLTree(data)
}

func decodeJSONTree(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := readJSONValue(dec)
	if err != nil {
		return nil, errors.New("the file is not valid JSON (" + jsonProblem(err) + ")")
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("the file is not valid JSON (unexpected data after the document)")
	}
	return v, nil
}

func readJSONValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	if t, ok := tok.(json.Delim); ok {
		switch t {
		case '{':
			o := newOmap()
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, err
				}
				k, _ := kt.(string)
				v, err := readJSONValue(dec)
				if err != nil {
					return nil, err
				}
				o.set(k, v)
			}
			_, err := dec.Token() // }
			return o, err
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := readJSONValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			_, err := dec.Token() // ]
			return arr, err
		}
	}
	return tok, nil // string, json.Number, bool, nil
}

func decodeYAMLTree(data []byte) (any, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, errors.New("the file is neither valid JSON nor valid YAML (" + strings.TrimPrefix(err.Error(), "yaml: ") + ")")
	}
	if doc.Kind == 0 || len(doc.Content) == 0 {
		return nil, errors.New("the file is empty")
	}
	return yamlValue(doc.Content[0], 0)
}

func yamlValue(n *yaml.Node, depth int) (any, error) {
	if depth > 200 {
		return nil, errors.New("the YAML document is nested too deeply")
	}
	switch n.Kind {
	case yaml.DocumentNode:
		if len(n.Content) == 0 {
			return nil, nil
		}
		return yamlValue(n.Content[0], depth+1)
	case yaml.AliasNode:
		return yamlValue(n.Alias, depth+1)
	case yaml.MappingNode:
		o := newOmap()
		for i := 0; i+1 < len(n.Content); i += 2 {
			k := n.Content[i]
			if k.Tag == "!!merge" { // "<<: *anchor"
				merged, err := yamlValue(n.Content[i+1], depth+1)
				if err != nil {
					return nil, err
				}
				if m, ok := merged.(*omap); ok {
					for _, mk := range m.keys {
						if !o.has(mk) {
							o.set(mk, m.vals[mk])
						}
					}
				}
				continue
			}
			v, err := yamlValue(n.Content[i+1], depth+1)
			if err != nil {
				return nil, err
			}
			o.set(k.Value, v)
		}
		return o, nil
	case yaml.SequenceNode:
		arr := make([]any, 0, len(n.Content))
		for _, c := range n.Content {
			v, err := yamlValue(c, depth+1)
			if err != nil {
				return nil, err
			}
			arr = append(arr, v)
		}
		return arr, nil
	}
	// Scalars: resolve the YAML tag to JSON-compatible values.
	switch n.Tag {
	case "!!null":
		return nil, nil
	case "!!bool":
		b, _ := strconv.ParseBool(strings.ToLower(n.Value))
		return b, nil
	case "!!int", "!!float":
		if _, err := strconv.ParseFloat(strings.ReplaceAll(n.Value, "_", ""), 64); err == nil {
			return json.Number(strings.ReplaceAll(n.Value, "_", "")), nil
		}
		return n.Value, nil
	case "!!timestamp":
		var t time.Time
		if n.Decode(&t) == nil {
			if len(n.Value) == len("2006-01-02") {
				return t.Format("2006-01-02"), nil
			}
			return t.Format(time.RFC3339), nil
		}
	}
	return n.Value, nil
}

// treeJSON is the tree as compact JSON (keys in order).
func treeJSON(v any) ([]byte, error) { return marshalValue(v) }

// resolvePointer follows a local JSON pointer ("#/components/schemas/Pet",
// "#/paths/~1pets/get/...") from root.
func resolvePointer(root any, ref string) (any, error) {
	if !strings.HasPrefix(ref, "#") {
		return nil, fmt.Errorf("external reference %q", ref)
	}
	frag := strings.TrimPrefix(ref, "#")
	if u, err := url.PathUnescape(frag); err == nil {
		frag = u
	}
	if frag == "" || frag == "/" {
		return root, nil
	}
	cur := root
	for _, part := range strings.Split(strings.TrimPrefix(frag, "/"), "/") {
		part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		switch c := cur.(type) {
		case *omap:
			if !c.has(part) {
				return nil, fmt.Errorf("reference %q points to nothing", ref)
			}
			cur = c.get(part)
		case []any:
			i, err := strconv.Atoi(part)
			if err != nil || i < 0 || i >= len(c) {
				return nil, fmt.Errorf("reference %q points to nothing", ref)
			}
			cur = c[i]
		default:
			return nil, fmt.Errorf("reference %q points to nothing", ref)
		}
	}
	return cur, nil
}
