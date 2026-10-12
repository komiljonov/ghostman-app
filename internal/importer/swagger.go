package importer

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/getkin/kin-openapi/openapi2"
	"github.com/getkin/kin-openapi/openapi2conv"
)

// Swagger 2.0 is accepted by CONVERSION, not by a second mapper: kin-openapi's
// openapi2conv turns it into OpenAPI 3.0, and the same OpenAPI mapper runs on the
// result. Known shapes of the converted spec the mapper handles:
//
//	host + basePath + schemes → one server per scheme (merged into ONE environment)
//	formData parameters       → a urlencoded / multipart requestBody
//	a "file" field            → type string, format binary (the file-drop rule)
//
// The converter returns maps, so the original path and method order is kept
// from the Swagger file (pathOrder) and reapplied.

type pathOrder struct {
	paths   map[string]int
	methods map[string][]string
}

func (o *pathOrder) sortPaths(keys []string) []string {
	out := slices.Clone(keys)
	slices.SortStableFunc(out, func(a, b string) int { return o.index(a) - o.index(b) })
	return out
}

func (o *pathOrder) index(p string) int {
	if i, ok := o.paths[p]; ok {
		return i
	}
	return len(o.paths)
}

func (o *pathOrder) sortMethods(path string, methods []string) []string {
	want := o.methods[path]
	out := slices.Clone(methods)
	slices.SortStableFunc(out, func(a, b string) int {
		ia, ib := slices.Index(want, a), slices.Index(want, b)
		if ia < 0 {
			ia = len(want)
		}
		if ib < 0 {
			ib = len(want)
		}
		return ia - ib
	})
	return out
}

// convertSwagger converts a Swagger 2.0 tree to an OpenAPI 3.0 tree.
func convertSwagger(doc *omap) (*omap, *pathOrder, error) {
	order := &pathOrder{paths: map[string]int{}, methods: map[string][]string{}}
	for i, p := range doc.obj("paths").Keys() {
		order.paths[p] = i
		order.methods[p] = slices.Clone(doc.obj("paths").obj(p).Keys())
	}
	raw, err := treeJSON(doc)
	if err != nil {
		return nil, nil, err
	}
	var v2 openapi2.T
	if err := json.Unmarshal(raw, &v2); err != nil {
		return nil, nil, errors.New("the Swagger 2.0 spec could not be read (" + jsonProblem(err) + ")")
	}
	v3, err := openapi2conv.ToV3(&v2)
	if err != nil {
		return nil, nil, errors.New("the Swagger 2.0 spec could not be converted to OpenAPI 3: " + strings.TrimSpace(err.Error()))
	}
	out, err := json.Marshal(v3)
	if err != nil {
		return nil, nil, errors.New("the converted spec could not be written: " + err.Error())
	}
	tree, err := decodeJSONTree(out)
	if err != nil {
		return nil, nil, err
	}
	converted, ok := tree.(*omap)
	if !ok {
		return nil, nil, errors.New("the Swagger 2.0 spec could not be converted to OpenAPI 3")
	}
	return converted, order, nil
}
